import React, { Suspense, useEffect, useState } from 'react';
import { Routes, Route, useNavigate, Navigate, Outlet } from 'react-router-dom';
import Loading from './components/Loading';
import './styles/index.css';
import ScrollToTop from "./components/ScrollToTop";
import { authFetch, isLoggedIn, logout } from './utils/auth';


const Index = React.lazy(() => import('./pages/Index'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'))

function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

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


    if (user && user.is_banned) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center px-4">
                <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full border-t-4 border-red-500">
                    <h1 className="text-3xl font-bold text-gray-800 mb-4">Account Suspended</h1>
                    <p className="text-gray-600 mb-4">
                        Your access to this application has been temporarily restricted due to a violation of our terms.
                    </p>

                    {user.banned_until && (() => {
                        const date = new Date(user.banned_until);
                        const day = String(date.getDate()).padStart(2, "0");
                        const month = String(date.getMonth() + 1).padStart(2, "0");
                        const year = date.getFullYear();
                        const hours = String(date.getHours()).padStart(2, "0");
                        const minutes = String(date.getMinutes()).padStart(2, "0");

                        return (
                            <div className="bg-red-50 p-3 rounded text-red-700 font-medium mb-6">
                                Ban lifts on: {`${day}.${month}.${year} ${hours}:${minutes}`}
                            </div>
                        );
                    })()}

                    <button
                        type="button"
                        onClick={() => {
                            logout(); // revokes the refresh token and clears stored tokens
                            setUser(null);
                            navigate('/login');
                        }}
                        className="text-blue-600 hover:underline"
                    >
                        Return to Login
                    </button>
                </div>
            </div>
        );
    }


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