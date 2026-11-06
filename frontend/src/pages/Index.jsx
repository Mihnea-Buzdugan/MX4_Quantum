import React from "react";

function Index({ onLogout }) {
  return (
    <div>
      <h1>Welcome to my app</h1>
      <p>This is the home page.</p>

      <button
        type="button"
        onClick={onLogout}
        className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
      >
        Logout
      </button>
    </div>
  );
}

export default Index;