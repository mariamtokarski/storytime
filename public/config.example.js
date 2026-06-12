// ============================================================================
//  STORY TIME — BACKEND CONFIG  (Firebase)
// ----------------------------------------------------------------------------
//  Paste your Firebase web config below. If you follow the deploy steps in
//  README.md, you'll already be in the Firebase console for all of this.
//
//  Where to find these values:
//    Firebase console → gear icon → Project settings →
//    scroll to "Your apps" → your web app → "SDK setup and configuration" →
//    copy the values from the firebaseConfig object it shows you.
//
//  Make sure you have also:
//    • Created a Realtime Database   (Build → Realtime Database → Create)
//    • Enabled Anonymous sign-in     (Build → Authentication → Sign-in method)
//  Both are covered step-by-step in README.md.
// ============================================================================

window.FIREBASE_CONFIG = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://PASTE_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "PASTE_PROJECT_ID",
  storageBucket:     "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID"
};
