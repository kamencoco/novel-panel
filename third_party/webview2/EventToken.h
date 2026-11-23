// Minimal ABI-equivalent shim for the Windows SDK's EventToken.h.
// MinGW-w64 does not ship that header; WebView2.h only needs the flat struct.
#pragma once

typedef struct EventRegistrationToken {
    __int64 value;
} EventRegistrationToken;
