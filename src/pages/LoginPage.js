import React, { useRef } from 'react';
import { auth } from '../firebase';
import { signInWithEmailAndPassword } from "firebase/auth";
import { Link } from 'react-router-dom';

const LoginPage = () => {
  const emailRef = useRef();
  const passwordRef = useRef();

  const handleLogin = () => {
    signInWithEmailAndPassword(auth, emailRef.current.value, passwordRef.current.value)
      .then((userCredential) => {
        // Signed in 
        const user = userCredential.user;
        console.log('User logged in:', user);
      })
      .catch((error) => {
        alert('Error logging in:');
      });
  };

  return (
    <div>
      <h2>Login</h2>
      <input 
        type="email" 
        placeholder="Email" 
        ref={emailRef}
      />
      <br />
      <input 
        type="password" 
        placeholder="Password" 
        ref={passwordRef}
      />
      <br />
      <button onClick={handleLogin}>Log In</button>
      <p>Don't have an account? <Link to="/create-user">Create one</Link></p>
      <p>Forgot your password? <Link to="/reset-password">Reset it</Link></p>
    </div>
  );
};

export default LoginPage;