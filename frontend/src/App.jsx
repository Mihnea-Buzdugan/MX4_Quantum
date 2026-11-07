import React, { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Loading from './components/Loading';
import './styles/index.css';
import ScrollToTop from "./components/ScrollToTop";
import { authFetch, isLoggedIn, logout } from './utils/auth';


const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'))

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Returns the promise so AuthPage can `await` it before it navigates.
    const fetchUser = () => {
        // No valid session stored: skip the request, the route guard sends us to /login.
        if (!isLoggedIn()) {
            setUser(null);
            setLoading(false);
            return Promise.resolve();
        }

        return authFetch('/api/user/')
            .then(response => {
                if (!response.ok) throw new Error("Unauthorized");
                return response.json();
            })
            .then(data => {
                const userData = data.user || data;
                if (userData && userData.id) {
                    setUser(userData);
                }
            })
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchUser();
    }, []);

    const handleLogout = () => {
        logout();      // clears tokens right away and revokes the refresh token in the background
        setUser(null); // the route guard then redirects to /login
    };

    if (loading) return <Loading />;


    return (
        <div className="min-h-screen bg-white">

            <Suspense fallback={<Loading />}>
                <ScrollToTop />
                <Routes>
                    {/* AuthPage stores the tokens, then calls fetchUser() so `user` is set before
                        it navigates to "/". Logged-in users are redirected away from these pages. */}
                    <Route
                        path="/login"
                        element={user ? <Navigate to="/" replace /> : <AuthPage mode="login" onLoginSuccess={fetchUser} />}
                    />
                    <Route
                        path="/register"
                        element={user ? <Navigate to="/" replace /> : <AuthPage mode="register" onLoginSuccess={fetchUser} />}
                    />

                    <Route element={user ? <Outlet /> : <Navigate to="/login" replace />}>
                        <Route path="/" element={<DashboardPage />} />
                    </Route>

                    <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </Suspense>
        </div>
    );
}

export default App;