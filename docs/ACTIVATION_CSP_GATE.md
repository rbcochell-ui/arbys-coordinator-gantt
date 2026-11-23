# CSP gate for an authorized two-button build

The checked-in GitHub Pages candidate remains held: both draft buttons are
disabled, its Entra and SharePoint bindings are empty, and its parent-page CSP
allows network requests to the same origin only. Do not widen that CSP or
enable the buttons solely because this source check passes.

After Coca-Cola approves the exact host, Entra SPA registration, delegated
scopes, and per-List grants, prepare a separate enabled build. Its built
parent page must keep the existing script hashes and allow exactly these
network destinations:

| Directive | Exact required sources |
| --- | --- |
| connect-src | 'self', https://login.microsoftonline.com, https://graph.microsoft.com |
| frame-src | 'self', about:, https://login.microsoftonline.com |

The login origin follows this app's fixed MSAL authority. The Graph origin
follows its fixed API endpoint. The frame source accommodates MSAL's silent
authentication path; the dedicated redirect bridge must also remain usable.
The validator rejects extra origins, wildcards, duplicate CSP directives,
unpinning of scripts, and changes to the current restrictive baseline:
default/object/base/form/image/font/worker sources remain none, while the
existing inline-style allowance is unchanged.

Run the local check against the **built** parent HTML:

    node scripts/verify-activation-csp.mjs path/to/enabled-build/index.html

It must fail against the current held root and source pages with
"CSP_CONNECT_SRC_NOT_EXACT". The check changes no file. A passing result
only proves the named meta CSP is present in that file. It does not prove
the actual Pages response lacks a stricter HTTP CSP header, that Microsoft
accepted the registered redirect and scopes, or that Graph/List access works.
Those are separate signed-in and signed-out browser release checks.

Microsoft references:

- MSAL configuration and authority:
  https://learn.microsoft.com/en-us/entra/msal/javascript/browser/configuration
- MSAL browser sign-in and silent iframe behavior:
  https://learn.microsoft.com/en-us/entra/msal/javascript/browser/login-user
- Microsoft Graph SPA registration:
  https://learn.microsoft.com/en-us/entra/msal/javascript/browser/about-msal-browser

No mailbox send permission or Send API belongs in the app.
