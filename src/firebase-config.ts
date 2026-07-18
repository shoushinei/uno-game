// ========================================
// Firebase 設定
// ========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, connectDatabaseEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
}

const firebaseConfig: FirebaseConfig = {
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
// 認証系メール（メールリンクログイン等）をFirebase内蔵の日本語テンプレートで
// 送信させる（既定は英語で、日本のユーザーには不親切＋迷惑メール判定されやすい）
auth.languageCode = 'ja';
export const googleProvider = new GoogleAuthProvider();

// アカウント機能（users/ 等）用の Cloud Firestore。
// ゲームのリアルタイム同期は従来どおり Realtime Database（rooms/）を使い、
// アカウント・戦績・実績・フレンドは Firestore に分ける（Phase 1〜）。
export const firestore = getFirestore(app);

// ========================================
// ★デバッグ用★ ローカルで開いている時だけ Database Emulator に接続する
// GitHub Pages（本番）にデプロイした際は location.hostname が
// "localhost" にならないため、この分岐には入らず通常どおり本番Firebaseに繋がる。
// ========================================
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  console.log("🔧 Database/Firestore Emulator に接続しました（本番データではありません）");
}