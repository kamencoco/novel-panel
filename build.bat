@echo off
setlocal
cd /d "%~dp0"

echo [1/4] 编译资源 ...
windres src\app.rc -O coff -o src\app.res.o
if errorlevel 1 goto :err

echo [2/4] 编译主程序 ...
if not exist dist mkdir dist
g++ -std=c++17 -O2 -municode -mwindows -Isrc -Ithird_party\webview2 -Ithird_party ^
    src\main.cpp src\app.res.o ^
    -o "dist\金手指.exe" ^
    -lole32 -loleaut32 -lshlwapi -luuid -static -static-libgcc -static-libstdc++
if errorlevel 1 goto :err

echo [3/4] 复制前端 ...
xcopy frontend "dist\frontend" /E /I /Y >nul
if errorlevel 1 goto :err

echo [4/4] 复制 WebView2Loader.dll ...
copy /Y third_party\webview2\WebView2Loader.dll "dist\WebView2Loader.dll" >nul
if errorlevel 1 goto :err

echo.
echo 构建完成：dist\金手指.exe
exit /b 0

:err
echo.
echo 构建失败，请确认 MinGW g++ 与 windres 已在 PATH 中。
exit /b 1
