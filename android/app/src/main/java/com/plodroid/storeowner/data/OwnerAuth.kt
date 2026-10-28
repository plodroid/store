package com.plodroid.storeowner.data

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.plodroid.storeowner.notify.DeviceRegistrar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

sealed class AuthState {
    data object Checking : AuthState()
    data object SignedOut : AuthState()
    data class NotOwner(val uid: String, val email: String) : AuthState()
    data class Owner(val uid: String, val email: String) : AuthState()
    data class Problem(val message: String) : AuthState()
}

/**
 * Owner sign-in. Being signed in is not enough: the account must also have a
 * document at owners/{uid}, which only the Firebase console can create.
 * The security rules enforce the same check on the server.
 */
class OwnerAuth(private val context: Context, private val scope: CoroutineScope) {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private val _state = MutableStateFlow<AuthState>(AuthState.Checking)
    val state: StateFlow<AuthState> = _state
    private var checkJob: Job? = null

    private val listener = FirebaseAuth.AuthStateListener { evaluate(it.currentUser) }

    init { auth.addAuthStateListener(listener) }

    fun close() = auth.removeAuthStateListener(listener)

    val email: String? get() = auth.currentUser?.email

    fun recheck() = evaluate(auth.currentUser)

    private fun evaluate(user: FirebaseUser?) {
        checkJob?.cancel()
        if (user == null) { _state.value = AuthState.SignedOut; return }
        _state.value = AuthState.Checking
        checkJob = scope.launch {
            _state.value = try {
                val doc = db.collection("owners").document(user.uid).get().await()
                if (doc.exists()) {
                    DeviceRegistrar.registerCurrent(context)
                    AuthState.Owner(user.uid, user.email.orEmpty())
                } else AuthState.NotOwner(user.uid, user.email.orEmpty())
            } catch (e: Exception) {
                AuthState.Problem(friendlyMessage(e))
            }
        }
    }

    suspend fun signIn(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) throw UserFacingException("Enter your email and password.")
        auth.signInWithEmailAndPassword(email.trim(), password).await()
    }

    suspend fun sendReset(email: String) {
        if (email.isBlank()) throw UserFacingException("Type your email above first, then tap \"Forgot password\".")
        auth.sendPasswordResetEmail(email.trim()).await()
    }

    suspend fun signOut() {
        // Stop push alerts to this phone before signing out (best effort).
        runCatching { DeviceRegistrar.unregisterCurrent() }
        auth.signOut()
    }
}
