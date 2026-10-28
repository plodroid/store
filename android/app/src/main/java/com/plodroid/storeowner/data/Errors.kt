package com.plodroid.storeowner.data

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.storage.StorageException
import kotlinx.coroutines.TimeoutCancellationException

/** Thrown before a write is attempted, so nothing half-saves. */
class OfflineException : Exception("You're offline, so nothing was saved. Connect to the internet and try again.")

/** A problem the owner can fix (wrong input, blocked action). The message is shown as-is. */
class UserFacingException(message: String) : Exception(message)

/** Turns any failure into a short sentence a non-technical owner can act on. */
fun friendlyMessage(e: Throwable): String = when (e) {
    is OfflineException, is UserFacingException -> e.message.orEmpty()
    is TimeoutCancellationException ->
        "The server didn't answer in time, so we can't confirm this was saved. Check your connection, then look again."
    is FirebaseNetworkException -> "Couldn't reach the server. Check your internet connection and try again."
    is FirebaseTooManyRequestsException -> "Too many attempts. Please wait a few minutes and try again."
    is FirebaseAuthInvalidUserException -> "There's no owner account with that email, or it has been turned off."
    is FirebaseAuthInvalidCredentialsException -> "That email or password isn't right."
    is FirebaseAuthException -> "Sign-in didn't work. Please try again."
    is FirebaseFirestoreException -> when (e.code) {
        FirebaseFirestoreException.Code.UNAVAILABLE, FirebaseFirestoreException.Code.DEADLINE_EXCEEDED ->
            "Couldn't reach the server, so nothing was changed. Check your connection and try again."
        FirebaseFirestoreException.Code.PERMISSION_DENIED ->
            "This account isn't allowed to do that. Make sure you're signed in as the shop owner."
        FirebaseFirestoreException.Code.UNAUTHENTICATED -> "Your sign-in has expired. Please sign in again."
        FirebaseFirestoreException.Code.NOT_FOUND -> "That item no longer exists. It may have been removed on another phone."
        FirebaseFirestoreException.Code.ABORTED -> "Someone else changed this at the same moment. Please try again."
        FirebaseFirestoreException.Code.FAILED_PRECONDITION -> "The database needs a quick setup step (an index). See the README's troubleshooting section."
        else -> "Something went wrong on the server (${e.code.name.lowercase()}). Nothing was changed."
    }
    is StorageException -> when (e.errorCode) {
        StorageException.ERROR_NOT_AUTHORIZED -> "This account isn't allowed to upload photos."
        StorageException.ERROR_RETRY_LIMIT_EXCEEDED -> "The photo upload kept failing. Check your connection and try again."
        StorageException.ERROR_QUOTA_EXCEEDED -> "Photo storage is full on your Firebase plan."
        else -> "The photo couldn't be uploaded, so the product wasn't saved. Please try again."
    }
    else -> e.message?.takeIf { it.isNotBlank() && it.length < 160 } ?: "Something unexpected went wrong. Nothing was changed."
}
