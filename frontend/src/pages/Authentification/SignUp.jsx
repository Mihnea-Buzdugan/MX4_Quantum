import React, { useState } from 'react';
import styles from '../../styles/Authentification/registration.module.css';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faEyeSlash } from '@fortawesome/free-regular-svg-icons';
import { GoogleLogin } from "@react-oauth/google";
import { setTokens, apiUrl } from '../../utils/auth';

const SignUp = ({ onLoginSuccess }) => {
    const [showPassword1, setShowPassword1] = useState(false);
    const [showPassword2, setShowPassword2] = useState(false);

    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const navigate = useNavigate();

    const togglePasswordVisibility = (passwordId) => {
        if (passwordId === 'password1') {
            setShowPassword1(!showPassword1);
        } else {
            setShowPassword2(!showPassword2);
        }
    };


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        if (password.length < 8) {
            alert('Password must be at least 8 characters long');
            return;
        }
        if (!email.includes('@')) {
            alert('Please enter a valid email address');
            return;
        }

        const userData = {
            email,
            password,
            first_name: firstName,
            last_name: lastName,
            username,
        };

        try {
            const response = await fetch(apiUrl('/api/signup/'), {
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
            console.error('Error during sign-up:', error);
            alert('There was an error during sign-up');
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
            <div className={styles["custom-shape-divider-bottom-1740491939"]}>
                <svg
                    data-name="Layer 1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 1200 120"
                    preserveAspectRatio="none"
                >
                    <path
                        d="M598.97 114.72L0 0 0 120 1200 120 1200 0 598.97 114.72z"
                        className={styles["shape-fill"]}
                    ></path>
                </svg>
            </div>

            <img src="/logo.png" className={styles.harta} alt="Map" />
            <div className={styles["main-container"]}>
                <div className={styles.signup}>
                    <h1 className={styles["signup-titlu"]}>Sign Up for Free</h1>

                    <div className={styles.sus}>
                        <div className={`${styles.Prenume} ${styles.nume}`}>
                            <input
                                type="text"
                                className={styles.inputs}
                                required
                                autoComplete="off"
                                placeholder="First Name*"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                            />
                        </div>

                        <div className={`${styles.Nume} ${styles.nume}`}>
                            <input
                                type="text"
                                className={styles.inputs}
                                required
                                autoComplete="off"
                                placeholder="Last Name*"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <input
                            type="text"
                            className={styles.inputs}
                            required
                            autoComplete="off"
                            placeholder="UserName*"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>

                    <div className={styles.email}>
                        <input
                            type="email"
                            className={styles.inputs}
                            required
                            autoComplete="off"
                            placeholder="Email*"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    <div className={styles.parole}>
                        <div className={styles["password-field"]}>
                            <input
                                type={showPassword1 ? 'text' : 'password'}
                                className={styles.inputs}
                                required
                                autoComplete="off"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <span
                                className={styles["toggle-passwords"]}
                                onClick={() => togglePasswordVisibility('password1')}
                            >
                                <FontAwesomeIcon
                                    icon={showPassword1 ? faEye : faEyeSlash}
                                    className={styles.customIcon}
                                />
                            </span>
                        </div>
                        <div className={styles["password-field"]}>
                            <input
                                type={showPassword2 ? 'text' : 'password'}
                                className={styles.inputs}
                                required
                                autoComplete="off"
                                placeholder="Confirm Pwd"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <span
                                className={styles["toggle-passwords"]}
                                onClick={() => togglePasswordVisibility('password2')}
                            >
                                <FontAwesomeIcon
                                    icon={showPassword2 ? faEye : faEyeSlash}
                                    className={styles.customIcon}
                                />
                            </span>
                        </div>
                    </div>

                    <div className={styles["sign-up"]}>
                        <button className={styles["buton-signup"]} onClick={handleSubmit}>
                            SIGN UP
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
                <h1 className={styles["titlu-text"]}>Already have an account?</h1>
                <div className={styles["welcome-text"]}>
                    Click below to go to the login page and authenticate yourself.
                </div>
                <button onClick={() => navigate('/Login')} className={styles.ionut}>
                    Login
                </button>
            </div>
        </div>
    );
};

export default SignUp;