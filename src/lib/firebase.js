import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL

// Only initialize Firebase if the database URL is configured
let db = null

if (databaseURL) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  }
  const app = initializeApp(firebaseConfig)
  db = getDatabase(app)
}

export { db }
