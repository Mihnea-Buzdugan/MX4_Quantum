import React from "react";
import styles from "../styles/Components/Footer.module.css";
import '../index.css';
import { Link } from "react-router-dom";

const Footer = () => {
    return (
        <footer className={styles.footer}>
            <div className={styles["footer-content"]}>
                <p>
                    &copy; 2026 PulseNet. Connecting neighbors, building stronger communities, and enabling real-time local support.
                </p>
                <p>
                    Designed & Developed by Buzdugan Mihnea-Andrei.
                    {" "}Have questions or feedbacks?
                    <Link to="/contact" className={styles.link}> Contact us</Link>
                </p>
            </div>
            <p className={styles["footer-quote"]}>
                "From strangers to neighbors — powering real-time community care."
            </p>
        </footer>
    );
};

export default Footer;