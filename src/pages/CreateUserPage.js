import React, { useRef } from 'react';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword } from "firebase/auth";
import { Link } from 'react-router-dom';

const CreateUserPage = () => {
  const emailRef = useRef();
  const passwordRef = useRef();

  const handleCreateUser = () => {
    createUserWithEmailAndPassword(auth, emailRef.current.value, passwordRef.current.value)
      .then((userCredential) => {
        // Signed in 
        const user = userCredential.user;
        console.log('User created:', user);
      })
      .catch((error) => {
        alert('Error creating user:');
      });
  };

  return (
    <div>
      <h2>Create Account</h2>
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
      <button onClick={handleCreateUser}>Create User</button>
      <p>Already have an account? <Link to="/">Log in</Link></p>
    </div>
  );
};

export default CreateUserPage;