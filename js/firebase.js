import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import firebaseConfig from "./firebaseConfig.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

function clearLocalProgress() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (/^progress_/.test(k) || /^np_daily_/.test(k) || k === "tm_attempts_v1" || k === 'tm_day_count' || k === 'tm_last_increment') toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}
async function loadOrCreateCloudProgress(uid) {
  const ref = doc(db, "progress", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  } else {
    await setDoc(ref, {});
  }
}
async function fcSaveCloud() {
  if (!auth.currentUser) return;
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (/^progress_/.test(k) || /^np_daily_/.test(k) || k === "tm_attempts_v1" || k === 'tm_day_count' || k === 'tm_last_increment') data[k] = localStorage.getItem(k);
  }
  await setDoc(doc(db, "progress", auth.currentUser.uid), data);
}
window.fcSaveCloud = fcSaveCloud;

async function afterLogin() { clearLocalProgress(); await loadOrCreateCloudProgress(auth.currentUser.uid); location.reload(); }
async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); await afterLogin(); }
  catch { await signInWithRedirect(auth, provider); }
}
async function signOutUser() { await signOut(auth); clearLocalProgress(); location.reload(); }
getRedirectResult(auth).then(async (res) => { if (res && res.user) await afterLogin(); }).catch(() => {});

function ensureAuthUI() {
  const hosts = [document.querySelector(".nav-right"), document.querySelector(".side-footer")].filter(Boolean);
  hosts.forEach(host => {
    let box = host.querySelector(".auth-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "auth-box";
      box.style.display = "flex";
      box.style.gap = "6px";
      if (host.classList.contains("nav-right")) {
        box.style.flexDirection = "row";
        box.style.marginTop = "0";
      } else {
        box.style.flexDirection = "column";
        box.style.marginTop = "10px";
      }
      host.appendChild(box);
    }
    if (!host.classList.contains("nav-right") && !box.querySelector(".auth-status")) {
      const s = document.createElement("div");
      s.className = "auth-status muted";
      box.appendChild(s);
    }
    if (!box.querySelector(".auth-btn")) {
      const b = document.createElement("button");
      b.className = "auth-btn btn";
      box.appendChild(b);
    }
  });
}
function renderAuthUI(user) {
  ensureAuthUI();
  document.querySelectorAll(".auth-status").forEach(el => {
    el.textContent = user ? `Signed in as ${user.email}` : "Not signed in";
  });
  document.querySelectorAll(".auth-btn").forEach(btn => {
    btn.textContent = user ? "Log Out" : "Login with Google";
  });
}
onAuthStateChanged(auth, (user) => renderAuthUI(user));
document.addEventListener("DOMContentLoaded", () => {
  renderAuthUI(auth.currentUser);
});

window.signInWithGoogle = () => auth.currentUser ? signOutUser() : signInWithGoogle();
