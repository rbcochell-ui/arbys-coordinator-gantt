import {broadcastResponseToMainFrame} from '@azure/msal-browser/redirect-bridge';

// The dedicated redirect page runs only this bridge. It performs no Graph
// request, chart load, routing, token logging, or app initialization.
void broadcastResponseToMainFrame();
