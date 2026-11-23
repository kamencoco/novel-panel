// 金手指 (NovelPanel) — 系统文小说面板数据维护工具
// Win32 + WebView2 宿主。前端（HTML/CSS/JS）通过 postMessage RPC 与本后端通信。
// 后端只负责：窗口、存储（%APPDATA%\NovelPanel）、导出、打开文件夹。

// MinGW 8.1 默认 WINVER 较低，显式提升以启用 SHGetKnownFolderPath 等 Vista+ API。
#ifndef WINVER
#define WINVER 0x0601
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

#include <sal.h>

// MinGW 的 sal.h 可能缺少部分 SAL 注解宏，提前兜底定义。
#ifndef _COM_Outptr_
#define _COM_Outptr_
#endif
#ifndef _COM_Outptr_opt_
#define _COM_Outptr_opt_
#endif
#ifndef _Ret_maybenull_
#define _Ret_maybenull_
#endif
#ifndef _Ret_notnull_
#define _Ret_notnull_
#endif
#ifndef _Maybenull_
#define _Maybenull_
#endif
#ifndef _Notnull_
#define _Notnull_
#endif
#ifndef _Readable_bytes_
#define _Readable_bytes_(x)
#endif
#ifndef _Writable_bytes_
#define _Writable_bytes_(x)
#endif
#ifndef _Pre_readable_size_
#define _Pre_readable_size_(x)
#endif
#ifndef _Post_readable_size_
#define _Post_readable_size_(x)
#endif
#ifndef _Pre_writable_size_
#define _Pre_writable_size_(x)
#endif
#ifndef _Post_writable_size_
#define _Post_writable_size_(x)
#endif
#ifndef _In_reads_
#define _In_reads_(x)
#endif
#ifndef _Deref_out_opt_
#define _Deref_out_opt_
#endif

#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>

#include <cstdio>
#include <functional>
#include <string>
#include <vector>

#include "WebView2.h"
#include "webview2_uuids.h"  // MinGW 的 __uuidof 需要这些特化声明
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace {

const wchar_t kWindowClass[] = L"NovelPanelWindow";
const wchar_t kWindowTitle[] = L"金手指 · 系统文创作工作台";
const wchar_t kAppFolder[] = L"NovelPanel";
const wchar_t kMutexName[] = L"Local\\NovelPanel.SingleInstance";
const wchar_t kVirtualHost[] = L"app.novelpanel.local";
const char kAppVersion[] = "1.0.0";

std::wstring g_rootDir, g_booksDir, g_exportsDir, g_settingsPath, g_frontendDir;
HWND g_hwnd = nullptr;
ICoreWebView2Environment* g_env = nullptr;
ICoreWebView2Controller* g_controller = nullptr;
ICoreWebView2* g_webview = nullptr;
EventRegistrationToken g_msgToken = {0};

// ---------------------------------------------------------------- utilities

struct RpcError : std::runtime_error {
    explicit RpcError(const std::string& m) : std::runtime_error(m) {}
};

std::wstring wideFromUtf8(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], n);
    return w;
}

std::string utf8FromWide(const std::wstring& w) {
    if (w.empty()) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), &s[0], n, nullptr, nullptr);
    return s;
}

bool ReadTextFile(const std::wstring& path, std::string& out) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER size;
    if (!GetFileSizeEx(h, &size) || size.QuadPart < 0) {
        CloseHandle(h);
        return false;
    }
    out.resize((size_t)size.QuadPart);
    DWORD read = 0;
    BOOL ok = TRUE;
    if (size.QuadPart > 0) ok = ReadFile(h, &out[0], (DWORD)size.QuadPart, &read, nullptr);
    CloseHandle(h);
    return ok && read == (DWORD)size.QuadPart;
}

bool WriteTextFileAtomic(const std::wstring& path, const std::string& data) {
    std::wstring tmp = path + L".tmp";
    HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    BOOL ok = TRUE;
    if (!data.empty()) ok = WriteFile(h, data.data(), (DWORD)data.size(), &written, nullptr);
    CloseHandle(h);
    if (!ok || written != (DWORD)data.size()) {
        DeleteFileW(tmp.c_str());
        return false;
    }
    if (!MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING)) {
        DeleteFileW(tmp.c_str());
        return false;
    }
    return true;
}

void EnsureDir(const std::wstring& path) {
    CreateDirectoryW(path.c_str(), nullptr);  // 已存在也无妨
}

std::wstring BookPath(const std::string& id) {
    return g_booksDir + L"\\" + wideFromUtf8(id) + L".json";
}

bool IsValidId(const std::string& id) {
    if (id.empty() || id.size() > 64) return false;
    for (char c : id) {
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_'))
            return false;
    }
    return true;
}

std::wstring SanitizeFilename(std::wstring name) {
    const wchar_t* forbidden = L"\\/:*?\"<>|";
    std::wstring out;
    for (wchar_t c : name) {
        if (wcschr(forbidden, c)) continue;
        if ((unsigned)c < 32) continue;
        out += c;
    }
    // 去掉首尾空白
    size_t b = out.find_first_not_of(L" \t.");
    size_t e = out.find_last_not_of(L" \t.");
    if (b == std::wstring::npos) return L"面板导出";
    out = out.substr(b, e - b + 1);
    if (out.size() > 80) out = out.substr(0, 80);
    return out.empty() ? L"面板导出" : out;
}

std::string NowIso() {
    SYSTEMTIME st;
    GetSystemTime(&st);
    char buf[48];
    snprintf(buf, sizeof(buf), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", st.wYear, st.wMonth, st.wDay,
             st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
    return buf;
}

json ParseOrEmpty(const std::string& content) {
    json j = json::parse(content, nullptr, false);
    if (j.is_discarded()) return json();
    return j;
}

// ---------------------------------------------------------------- RPC

json HandleRpc(const std::string& method, const json& params) {
    if (method == "appInfo") {
        return json{{"version", kAppVersion}, {"dataDir", utf8FromWide(g_rootDir)}};
    }

    if (method == "listBooks") {
        json arr = json::array();
        WIN32_FIND_DATAW fd;
        HANDLE h = FindFirstFileW((g_booksDir + L"\\*.json").c_str(), &fd);
        if (h != INVALID_HANDLE_VALUE) {
            do {
                if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
                std::string content;
                if (!ReadTextFile(g_booksDir + L"\\" + fd.cFileName, content)) continue;
                json b = ParseOrEmpty(content);
                if (b.is_object()) {
                    std::string id = b.value("id", std::string());
                    if (id.empty()) {
                        std::wstring stem(fd.cFileName);
                        if (stem.size() > 5 && stem.compare(stem.size() - 5, 5, L".json") == 0)
                            stem = stem.substr(0, stem.size() - 5);
                        id = utf8FromWide(stem);
                    }
                    int nChapters = 0, nChars = 0;
                    if (b.contains("chapters") && b["chapters"].is_array()) nChapters = (int)b["chapters"].size();
                    if (b.contains("characters") && b["characters"].is_array()) nChars = (int)b["characters"].size();
                    json entry = json::object();
                    entry["id"] = id;
                    entry["title"] = b.value("title", std::string("未命名作品"));
                    entry["updatedAt"] = b.value("updatedAt", std::string());
                    entry["chapters"] = nChapters;
                    entry["chars"] = nChars;
                    arr.push_back(entry);
                }
            } while (FindNextFileW(h, &fd));
            FindClose(h);
        }
        return arr;
    }

    if (method == "loadBook") {
        std::string id = params.value("id", std::string());
        if (!IsValidId(id)) throw RpcError("invalid book id");
        std::string content;
        if (!ReadTextFile(BookPath(id), content)) throw RpcError("book not found");
        json b = ParseOrEmpty(content);
        if (!b.is_object()) throw RpcError("book file corrupted");
        return b;
    }

    if (method == "saveBook") {
        std::string id = params.value("id", std::string());
        if (!IsValidId(id)) throw RpcError("invalid book id");
        json data = params.value("data", json());
        if (!data.is_object()) throw RpcError("book data must be an object");
        data["id"] = id;
        data["updatedAt"] = NowIso();
        if (!WriteTextFileAtomic(BookPath(id), data.dump(2))) throw RpcError("failed to write book file");
        return json{{"updatedAt", data["updatedAt"]}};
    }

    if (method == "deleteBook") {
        std::string id = params.value("id", std::string());
        if (!IsValidId(id)) throw RpcError("invalid book id");
        DeleteFileW(BookPath(id).c_str());
        return json::object();
    }

    if (method == "getSettings") {
        std::string content;
        json s = ReadTextFile(g_settingsPath, content) ? ParseOrEmpty(content) : json();
        if (!s.is_object()) s = json{{"theme", "light"}, {"lastBookId", nullptr}};
        return s;
    }

    if (method == "saveSettings") {
        json data = params.value("data", json());
        if (!data.is_object()) throw RpcError("settings data must be an object");
        if (!WriteTextFileAtomic(g_settingsPath, data.dump(2))) throw RpcError("failed to write settings");
        return json::object();
    }

    if (method == "exportAll") {
        std::string fname = params.value("filename", std::string("面板导出"));
        std::string text = params.value("data", std::string());
        if (text.empty()) throw RpcError("nothing to export");
        std::wstring path = g_exportsDir + L"\\" + SanitizeFilename(wideFromUtf8(fname)) + L".txt";
        if (!WriteTextFileAtomic(path, text)) throw RpcError("failed to write export file");
        return json{{"path", utf8FromWide(path)}};
    }

    if (method == "openPath") {
        std::wstring p = wideFromUtf8(params.value("path", std::string()));
        if (p != g_rootDir && p != g_booksDir && p != g_exportsDir) throw RpcError("path not allowed");
        HINSTANCE r = ShellExecuteW(nullptr, L"open", p.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        if ((INT_PTR)r <= 32) throw RpcError("failed to open folder");
        return json::object();
    }

    throw RpcError("unknown method: " + method);
}

// ---------------------------------------------------------------- COM handlers

template <typename Itf, typename... Args>
class ComHandler : public Itf {
public:
    using Fn = std::function<void(Args...)>;
    explicit ComHandler(Fn fn) : fn_(std::move(fn)) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == __uuidof(Itf) || riid == __uuidof(IUnknown)) {
            *ppv = this;
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++ref_; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG r = --ref_;
        if (r == 0) delete this;
        return r;
    }
    HRESULT STDMETHODCALLTYPE Invoke(Args... args) override {
        fn_(args...);
        return S_OK;
    }

private:
    virtual ~ComHandler() = default;
    ULONG ref_ = 1;
    Fn fn_;
};

void PostJson(const json& msg) {
    if (!g_webview) return;
    std::wstring w = wideFromUtf8(msg.dump());
    g_webview->PostWebMessageAsJson(w.c_str());
}

void OnWebMessage(ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) {
    if (!sender) return;
    LPWSTR raw = nullptr;
    std::string msg;
    if (SUCCEEDED(args->get_WebMessageAsJson(&raw)) && raw) {
        msg = utf8FromWide(raw);
        CoTaskMemFree(raw);
    }
    json req = ParseOrEmpty(msg);
    if (!req.is_object()) return;

    int64_t id = req.value("id", (int64_t)0);
    std::string method = req.value("method", std::string());
    json params = req.contains("params") && req["params"].is_object() ? req["params"] : json::object();

    json resp;
    resp["id"] = id;
    try {
        resp["ok"] = true;
        resp["result"] = HandleRpc(method, params);
    } catch (const RpcError& e) {
        resp["ok"] = false;
        resp["error"] = e.what();
    } catch (const std::exception& e) {
        resp["ok"] = false;
        resp["error"] = std::string("internal: ") + e.what();
    }
    PostJson(resp);
}

void ShowRuntimeError(HRESULT hr, const char* what) {
    wchar_t whatW[80];
    MultiByteToWideChar(CP_UTF8, 0, what, -1, whatW, 80);
    wchar_t buf[512];
    swprintf(buf, 512,
             L"初始化 WebView2 失败 (%s, hr=0x%08lX)。\n\n"
             L"请确认系统已安装 Microsoft Edge WebView2 运行时，然后重试。",
             whatW, (unsigned long)hr);
    MessageBoxW(nullptr, buf, kWindowTitle, MB_ICONERROR);
}

void ApplyWebviewSettings() {
    if (!g_webview) return;
    ICoreWebView2Settings* st = nullptr;
    if (SUCCEEDED(g_webview->get_Settings(&st)) && st) {
        ICoreWebView2Settings2* st2 = nullptr;
        if (SUCCEEDED(st->QueryInterface(__uuidof(ICoreWebView2Settings2), (void**)&st2)) && st2) {
            st2->put_IsZoomControlEnabled(FALSE);  // 避免 Ctrl+滚轮误缩放
            st2->Release();
        }
        st->Release();
    }
}

void NavigateToFrontend() {
    if (!g_webview) return;
    ICoreWebView2_3* wv3 = nullptr;
    bool mapped = false;
    if (SUCCEEDED(g_webview->QueryInterface(__uuidof(ICoreWebView2_3), (void**)&wv3)) && wv3) {
        HRESULT hr = wv3->SetVirtualHostNameToFolderMapping(
            kVirtualHost, g_frontendDir.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
        if (SUCCEEDED(hr)) {
            std::wstring url = std::wstring(L"https://") + kVirtualHost + L"/index.html";
            wv3->Navigate(url.c_str());
            mapped = true;
        }
        wv3->Release();
    }
    if (!mapped) {
        std::wstring url = L"file:///" + g_frontendDir + L"/index.html";
        g_webview->Navigate(url.c_str());
    }
}

void OnControllerCreated(HRESULT hr, ICoreWebView2Controller* controller);  // 见下方定义

void OnEnvironmentCreated(HRESULT hr, ICoreWebView2Environment* env) {
    if (FAILED(hr) || !env) {
        ShowRuntimeError(hr, "CreateCoreWebView2Environment");
        PostQuitMessage(1);
        return;
    }
    g_env = env;
    env->AddRef();
    auto* handler = new ComHandler<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, HRESULT,
                                   ICoreWebView2Controller*>(
        [](HRESULT hr2, ICoreWebView2Controller* controller) { OnControllerCreated(hr2, controller); });
    env->CreateCoreWebView2Controller(g_hwnd, handler);
    handler->Release();
}

void OnControllerCreated(HRESULT hr, ICoreWebView2Controller* controller) {
    if (FAILED(hr) || !controller) {
        ShowRuntimeError(hr, "CreateCoreWebView2Controller");
        return;
    }
    g_controller = controller;
    controller->AddRef();
    if (FAILED(controller->get_CoreWebView2(&g_webview)) || !g_webview) {
        ShowRuntimeError(E_FAIL, "get_CoreWebView2");
        return;
    }
    RECT rc;
    GetClientRect(g_hwnd, &rc);
    controller->put_Bounds(rc);
    controller->put_IsVisible(TRUE);

    auto* msgHandler = new ComHandler<ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2*,
                                      ICoreWebView2WebMessageReceivedEventArgs*>(OnWebMessage);
    g_webview->add_WebMessageReceived(msgHandler, &g_msgToken);
    msgHandler->Release();

    ApplyWebviewSettings();
    NavigateToFrontend();

    if (g_controller) g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

// ---------------------------------------------------------------- window

void InitDpiAwareness() {
    HMODULE u32 = GetModuleHandleW(L"user32.dll");
    if (u32) {
        typedef BOOL(WINAPI * PFN_SetCtx)(HANDLE);
        PFN_SetCtx fn = (PFN_SetCtx)GetProcAddress(u32, "SetProcessDpiAwarenessContext");
        if (fn) {
            if (fn((HANDLE)-4)) return;  // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        }
    }
    // 回退：Shcore 的按监视器感知（V1）
    HMODULE shcore = LoadLibraryW(L"Shcore.dll");
    if (shcore) {
        typedef HRESULT(WINAPI * PFN_SetAwareness)(int);
        PFN_SetAwareness fn = (PFN_SetAwareness)GetProcAddress(shcore, "SetProcessDpiAwareness");
        if (fn && SUCCEEDED(fn(2))) return;  // PROCESS_PER_MONITOR_DPI_AWARE
    }
    SetProcessDPIAware();
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_SIZE:
            if (g_controller && wParam != SIZE_MINIMIZED) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                g_controller->put_Bounds(rc);
            }
            return 0;
        case WM_DPICHANGED: {  // 跨显示器拖动时按系统建议矩形重设窗口（保持逻辑尺寸）
            RECT* r = (RECT*)lParam;
            SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_ERASEBKGND:
            return 1;
        case WM_ACTIVATE:
            if (g_controller && LOWORD(wParam) != WA_INACTIVE)
                g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            return 0;
        case WM_DESTROY:
            if (g_webview) {
                g_webview->remove_WebMessageReceived(g_msgToken);
                g_webview->Release();
                g_webview = nullptr;
            }
            if (g_controller) {
                g_controller->Close();
                g_controller->Release();
                g_controller = nullptr;
            }
            if (g_env) {
                g_env->Release();
                g_env = nullptr;
            }
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR, int nCmdShow) {
    InitDpiAwareness();

    HANDLE mutex = CreateMutexW(nullptr, TRUE, kMutexName);
    if (mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND prev = FindWindowW(kWindowClass, nullptr);
        if (prev) {
            ShowWindow(prev, SW_RESTORE);
            SetForegroundWindow(prev);
        }
        if (mutex) CloseHandle(mutex);
        return 0;
    }

    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;

    // 数据目录：%APPDATA%\NovelPanel
    PWSTR appData = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &appData))) return 1;
    g_rootDir = std::wstring(appData) + L"\\" + kAppFolder;
    CoTaskMemFree(appData);
    g_booksDir = g_rootDir + L"\\books";
    g_exportsDir = g_rootDir + L"\\exports";
    g_settingsPath = g_rootDir + L"\\settings.json";
    EnsureDir(g_rootDir);
    EnsureDir(g_booksDir);
    EnsureDir(g_exportsDir);

    // 前端目录：exe 同级的 frontend 文件夹（注意此注释行尾不能有反斜杠）
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    std::wstring exeDir(exePath);
    size_t slash = exeDir.find_last_of(L"\\/");
    if (slash != std::wstring::npos) exeDir = exeDir.substr(0, slash + 1);
    g_frontendDir = exeDir + L"frontend";
    if (GetFileAttributesW((g_frontendDir + L"\\index.html").c_str()) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(nullptr, L"缺少 frontend\\index.html，请将 frontend 文件夹与 exe 放在一起。",
                    kWindowTitle, MB_ICONERROR);
        return 1;
    }

    // WebView2Loader.dll：与 exe 同目录
    HMODULE loader = LoadLibraryW((exeDir + L"WebView2Loader.dll").c_str());
    if (!loader) loader = LoadLibraryW(L"WebView2Loader.dll");
    if (!loader) {
        MessageBoxW(nullptr, L"找不到 WebView2Loader.dll，请将其与 exe 放在同一目录。", kWindowTitle,
                    MB_ICONERROR);
        return 1;
    }
    typedef HRESULT(WINAPI * PFN_CreateEnv)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*,
                                            ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
    PFN_CreateEnv pCreateEnv = (PFN_CreateEnv)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
    if (!pCreateEnv) {
        MessageBoxW(nullptr, L"WebView2Loader.dll 版本过旧。", kWindowTitle, MB_ICONERROR);
        return 1;
    }

    // 注册窗口类
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.lpszClassName = kWindowClass;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(250, 250, 248));  // 近白，避免启动闪屏
    wc.hIcon = (HICON)LoadImageW(hInst, MAKEINTRESOURCEW(1), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE);
    wc.hIconSm = (HICON)LoadImageW(hInst, MAKEINTRESOURCEW(1), IMAGE_ICON, 16, 16, LR_DEFAULTCOLOR);
    if (!RegisterClassExW(&wc)) return 1;

    // 主窗口：1180x780 逻辑像素（DIP），按显示器 DPI 换算成物理像素后居中
    RECT work;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    HDC screenDC = GetDC(nullptr);
    UINT dpi = screenDC ? (UINT)GetDeviceCaps(screenDC, LOGPIXELSX) : 96;
    if (screenDC) ReleaseDC(nullptr, screenDC);
    if (!dpi) dpi = 96;
    int ww = MulDiv(1180, (int)dpi, 96);
    int wh = MulDiv(780, (int)dpi, 96);
    // 小屏（高缩放的低分辨率面板）时不超过工作区
    int maxW = work.right - work.left, maxH = work.bottom - work.top;
    if (ww > maxW) ww = maxW;
    if (wh > maxH) wh = maxH;
    int wx = work.left + ((work.right - work.left) - ww) / 2;
    int wy = work.top + ((work.bottom - work.top) - wh) / 2;
    g_hwnd = CreateWindowExW(0, kWindowClass, kWindowTitle,
                             WS_OVERLAPPEDWINDOW | WS_VISIBLE, wx, wy, ww, wh, nullptr, nullptr,
                             hInst, nullptr);
    if (!g_hwnd) return 1;
    // 窗口/任务栏图标（来自嵌入资源）
    SendMessageW(g_hwnd, WM_SETICON, ICON_BIG,
                 (LPARAM)LoadImageW(hInst, MAKEINTRESOURCEW(1), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE));
    SendMessageW(g_hwnd, WM_SETICON, ICON_SMALL,
                 (LPARAM)LoadImageW(hInst, MAKEINTRESOURCEW(1), IMAGE_ICON, 16, 16, LR_DEFAULTCOLOR));
    ShowWindow(g_hwnd, nCmdShow);
    UpdateWindow(g_hwnd);

    // 创建 WebView2 环境（用户数据放在数据目录内，避免污染系统）
    std::wstring userData = g_rootDir + L"\\WebView2";
    auto* envHandler = new ComHandler<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, HRESULT,
                                      ICoreWebView2Environment*>(OnEnvironmentCreated);
    HRESULT hr = pCreateEnv(nullptr, userData.c_str(), nullptr, envHandler);
    envHandler->Release();
    if (FAILED(hr)) {
        ShowRuntimeError(hr, "CreateCoreWebView2EnvironmentWithOptions");
        return 1;
    }

    MSG m;
    while (GetMessageW(&m, nullptr, 0, 0) > 0) {
        TranslateMessage(&m);
        DispatchMessageW(&m);
    }
    if (mutex) ReleaseMutex(mutex);
    CoUninitialize();
    return 0;
}
