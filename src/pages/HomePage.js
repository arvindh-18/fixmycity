import React, { useState } from 'react';
import { auth } from '../firebase';
import { signOut } from "firebase/auth";

const HomePage = ({ user }) => {
  const [idToken, setIdToken] = useState(null);

  const handleLogout = () => {
    signOut(auth).then(() => {
      console.log('User logged out');
    }).catch((error) => {
      console.error('Error logging out:', error);
    });
  };

  const handleGetIdToken = () => {
    user.getIdToken().then((token) => {
      console.log("token")
      setIdToken(token);
    });
  };

  return (
    <div>
      <h2>Welcome, {user.email}</h2>
      <button onClick={handleLogout}>Log Out</button>
      <br />
      <button onClick={handleGetIdToken}>Get ID Token</button>
      {idToken && (
        <div>
          <h3>ID Token:</h3>
          <p>{idToken}</p>
        </div>
      )}
    </div>
  );
};

export default HomePage;