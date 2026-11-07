import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";

import App from "./App.tsx";
import "./styles/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Could not find the application root element.");

// The Google sign-in button only works inside GoogleOAuthProvider. Without a client id
// (VITE_GOOGLE_CLIENT_ID in frontend/.env) the login page simply hides the Google button.
const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";

const app = (
    <BrowserRouter>
        <App />
    </BrowserRouter>
);

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
        {googleClientId ? <GoogleOAuthProvider clientId={googleClientId}>{app}</GoogleOAuthProvider> : app}
    </React.StrictMode>
);
