import React, { useState } from 'react';
import styles from '../../styles/Authentification/registration.module.css';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-regular-svg-icons';
import { GoogleLogin } from "@react-oauth/google";
import { setTokens, apiUrl } from '../../utils/auth';

const Login = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();

    const togglePasswordVisibility = () => {
        setShowPassword((prev) => !prev);
    };

    const handleSignUpClick = () => {
        navigate('/Signup');
    };


    const handleSubmit = async (e) => {
        e.preventDefault();

        const userData = {
            email,
            password,
        };

        try {
            const response = await fetch(apiUrl('/api/user_login/'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData),
            });

            if (response.ok) {
                const data = await response.json();
                setTokens(data.tokens);
                await onLoginSuccess?.();
            } else {
                const errorData = await response.json();
                alert('Error: ' + errorData.message);
            }
        } catch (error) {
            console.error('Error during login:', error);
            alert('There was an error during login');
        }
    };


    const handleGoogleLogin = async (response) => {
        const googleToken = response.credential;

        const resp = await fetch(apiUrl('/api/google_login/'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ google_token: googleToken })
        });
        if (resp.ok) {
            const data = await resp.json();
            setTokens(data.tokens);
            await onLoginSuccess?.();
        } else {
            const err = await resp.json();
            alert(err.message);
        }
    };


    return (
        <div>
            <div className={styles['custom-shape-divider-bottom-1740491939']}>
                <svg
                    data-name="Layer 1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 1200 120"
                    preserveAspectRatio="none"
                >
                    <path
                        d="M598.97 114.72L0 0 0 120 1200 120 1200 0 598.97 114.72z"
                        className={styles['shape-fill']}
                    ></path>
                </svg>
            </div>
            <img src="/logo.png" className={styles.harta} alt="Map" />
            <div className={styles['main-container']}>
                <div className={styles.signup}>
                    <h1 className={styles['signup-titlu']}>Login into your account</h1>
                    <div className="email">
                        <input
                            type="email"
                            className={styles.inputs}
                            required
                            autoComplete="off"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    <div className={styles.parole}>
                        <div className={styles['password-fields']}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className={styles.inputs}
                                required
                                autoComplete="off"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <span
                                className={styles['toggle-passwords']}
                                onClick={togglePasswordVisibility}
                            >
                                <FontAwesomeIcon
                                    icon={showPassword ? faEye : faEyeSlash}
                                    color='grey'
                                    className={styles.customIcon}
                                />
                            </span>
                        </div>
                    </div>

                    <div className="sign-up">
                        <button className={styles['buton-signup']} onClick={handleSubmit}>
                            LOGIN
                        </button>
                        <div className={styles.with}>
                            <p>Or with</p>
                        </div>
                        <div className={styles.providers}>
                            <GoogleLogin
                                onSuccess={(credentialResponse) => {
                                    handleGoogleLogin(credentialResponse);
                                }}
                                onError={() => alert("Login failed.")}
                            >
                            </GoogleLogin>
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.text}>
                <h1 className={styles['titlu-text']}>New here?</h1>
                <div className={styles['welcome-text']}>
                    Click on the sign-up page to create your account and start your journey with us!
                </div>
                <button onClick={handleSignUpClick} className={styles.ionut}>
                    Sign up
                </button>
            </div>
        </div>
    );
};

export default Login;