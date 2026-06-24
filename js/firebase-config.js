// ========================================
// Firebase 設定
// ※ GitHubにアップする場合は .gitignore に追加を推奨
// ========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA8J6e3FVKQHQ8hzmr0vSyUDJmn2N6QOHo",
  authDomain: "uno-game-b6d37.firebaseapp.com",
  databaseURL: "https://uno-game-b6d37-default-rtdb.firebaseio.com",
  projectId: "uno-game-b6d37",
  storageBucket: "uno-game-b6d37.firebasestorage.app",
  messagingSenderId: "737069316113",
  appId: "1:737069316113:web:99d9748f9c73802e3359b0",
  measurementId: "G-E0E2WLJ1RG"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export const auth = getAuth(app); 
export const googleProvider = new GoogleAuthProvider();