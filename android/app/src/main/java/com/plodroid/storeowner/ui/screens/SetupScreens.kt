package com.plodroid.storeowner.ui.screens

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.plodroid.storeowner.data.AuthState
import com.plodroid.storeowner.data.FirebaseConfig
import com.plodroid.storeowner.data.friendlyMessage
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.components.Dot
import com.plodroid.storeowner.ui.components.Field
import com.plodroid.storeowner.ui.components.Notice
import com.plodroid.storeowner.ui.components.PrimaryButton
import com.plodroid.storeowner.ui.components.SecondaryButton
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.EaseOutStrong
import com.plodroid.storeowner.ui.theme.LocalReducedMotion
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.system.exitProcess

@Composable
private fun Screen(content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding().imePadding(),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 24.dp),
        ) { content() }
    }
}

@Composable
private fun Badge(icon: ImageVector, tint: androidx.compose.ui.graphics.Color = C.Orange) {
    Box(
        Modifier.padding(horizontal = 20.dp).size(56.dp).clip(RoundedCornerShape(18.dp)).background(C.Surface2),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = tint, modifier = Modifier.size(28.dp)) }
}

@Composable
private fun Step(n: Int, text: String) {
    Row(Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
        Box(Modifier.size(24.dp).clip(CircleShape).background(C.Surface3), contentAlignment = Alignment.Center) {
            Text("$n", style = T.caption.copy(color = C.Text, fontWeight = FontWeight.SemiBold))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = T.body, modifier = Modifier.padding(top = 2.dp))
    }
}

/* ── 1. connect the app to the shop ───────────────────── */

@Composable
fun SetupScreen(vm: OwnerViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        scope.launch {
            val text = try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { s -> s.readBytes().take(200_000).toByteArray().decodeToString() }
                }
            } catch (e: Exception) { null }
            error = if (text == null) "That file couldn't be opened. Please try again." else vm.connectFromFile(text)
            busy = false
        }
    }

    Screen {
        Badge(Icons.Filled.ShoppingCart)
        Spacer(Modifier.height(18.dp))
        Text("Connect your shop", style = T.largeTitle, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(8.dp))
        Text(
            "This app manages the products, orders and feedback on your website. To link it, give it your shop's connection file once.",
            style = T.bodyMuted, modifier = Modifier.padding(horizontal = 20.dp),
        )
        Spacer(Modifier.height(18.dp))
        Step(1, "In the Firebase console, open your shop's project and add an Android app with the package name ${FirebaseConfig.PACKAGE}.")
        Step(2, "Download the google-services.json file it gives you onto this phone.")
        Step(3, "Tap the button below and choose that file.")
        Spacer(Modifier.height(20.dp))
        error?.let { Notice(it, Tone.RED) }
        PrimaryButton(
            "Choose google-services.json",
            onClick = { error = null; picker.launch(arrayOf("application/json", "application/octet-stream", "text/plain", "*/*")) },
            busy = busy,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth(),
        )
        SecondaryButton(
            "Look around with sample data first",
            onClick = { vm.startDemo() },
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp).fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "The full step-by-step setup guide is in the README of the shop's GitHub project.",
            style = T.caption, modifier = Modifier.padding(horizontal = 20.dp),
        )
    }
}

/* ── 2. sign in ───────────────────────────────────────── */

@Composable
fun SignInScreen(vm: OwnerViewModel) {
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }

    Screen {
        Badge(Icons.Filled.Lock)
        Spacer(Modifier.height(18.dp))
        Text("Owner sign-in", style = T.largeTitle, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(6.dp))
        Text("Use the owner account set up for your shop.", style = T.bodyMuted, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(16.dp))
        Field("Email", email, { email = it; error = null }, keyboard = KeyboardType.Email)
        Field(
            "Password", password, { password = it; error = null },
            keyboard = KeyboardType.Password,
            visual = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            trailing = { TextButton(onClick = { show = !show }) { Text(if (show) "Hide" else "Show", color = C.Muted) } },
        )
        error?.let { Notice(it, Tone.RED) }
        info?.let { Notice(it, Tone.GREEN) }
        PrimaryButton(
            "Sign in",
            busy = busy,
            enabled = email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp).fillMaxWidth(),
            onClick = {
                busy = true; error = null; info = null
                scope.launch {
                    try { vm.auth?.signIn(email, password) } catch (e: Exception) { error = friendlyMessage(e) }
                    busy = false
                }
            },
        )
        TextButton(
            onClick = {
                error = null; info = null
                scope.launch {
                    try { vm.auth?.sendReset(email); info = "We've emailed you a link to reset your password." }
                    catch (e: Exception) { error = friendlyMessage(e) }
                }
            },
            modifier = Modifier.padding(horizontal = 8.dp),
        ) { Text("Forgot password?", color = C.Blue) }
        Spacer(Modifier.height(20.dp))
        Text("Connected to: ${vm.projectId ?: "unknown"}", style = T.caption, modifier = Modifier.padding(horizontal = 20.dp))
        if (vm.connectedOnPhone) ForgetConnection(vm)
    }
}

/* ── 3. signed in, but not the owner yet ──────────────── */

@Composable
fun NotOwnerScreen(vm: OwnerViewModel, state: AuthState.NotOwner) {
    val clip = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    Screen {
        Badge(Icons.Filled.Lock, C.Blue)
        Spacer(Modifier.height(18.dp))
        Text("Almost there", style = T.largeTitle, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(6.dp))
        Text(
            "You're signed in as ${state.email.ifBlank { "this account" }}, but it hasn't been made the shop owner yet. " +
                "This keeps strangers out of your shop.",
            style = T.bodyMuted, modifier = Modifier.padding(horizontal = 20.dp),
        )
        Spacer(Modifier.height(16.dp))
        Step(1, "Copy your account code below.")
        Step(2, "In the Firebase console, open Firestore Database and start a collection called owners.")
        Step(3, "Add a document whose ID is your account code (it can have one field, like email).")
        Step(4, "Come back and tap \"Check again\".")
        Column(
            Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).padding(14.dp),
        ) {
            Text("Your account code", style = T.caption)
            Text(state.uid, style = T.body.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium))
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryButton(if (copied) "Copied" else "Copy code", onClick = { clip.setText(AnnotatedString(state.uid)); copied = true }, modifier = Modifier.weight(1f))
            PrimaryButton("Check again", onClick = { vm.auth?.recheck() }, modifier = Modifier.weight(1f))
        }
        TextButton(onClick = { vm.signOut() }, modifier = Modifier.padding(8.dp)) { Text("Sign out", color = C.Muted) }
    }
}

@Composable
fun ProblemScreen(vm: OwnerViewModel, message: String) {
    Screen {
        Badge(Icons.Filled.Refresh, C.Red)
        Spacer(Modifier.height(18.dp))
        Text("Couldn't check your account", style = T.largeTitle, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(10.dp))
        Notice(message, Tone.RED)
        PrimaryButton("Try again", onClick = { vm.auth?.recheck() }, modifier = Modifier.padding(16.dp).fillMaxWidth())
        TextButton(onClick = { vm.signOut() }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("Sign out", color = C.Muted) }
    }
}

@Composable
private fun ForgetConnection(vm: OwnerViewModel) {
    val context = LocalContext.current
    TextButton(
        onClick = {
            vm.forgetConnection()
            // Firebase can't switch projects while running, so restart cleanly.
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            context.startActivity(launch)
            (context as? Activity)?.finishAffinity()
            exitProcess(0)
        },
        modifier = Modifier.padding(horizontal = 8.dp),
    ) { Text("Use a different shop", color = C.Muted) }
}

/* ── 4. first-run intro ───────────────────────────────── */

private data class IntroPage(val icon: ImageVector, val title: String, val text: String)

@Composable
fun OnboardingScreen(vm: OwnerViewModel) {
    val pages = remember {
        listOf(
            IntroPage(Icons.Filled.ShoppingCart, "Run your shop from here", "Add products, set prices and stock, and handle orders and customer messages — all from this phone."),
            IntroPage(Icons.Filled.Refresh, "Changes go live straight away", "When you save a product, your website updates within seconds. If you're offline, the app tells you nothing was saved, so you're never left guessing."),
            IntroPage(Icons.Filled.Notifications, "Get told about new orders", "Allow notifications and your phone will alert you when an order or message arrives, even when the app is closed."),
        )
    }
    var page by remember { mutableIntStateOf(0) }
    val reduced = LocalReducedMotion.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { vm.finishOnboarding() }

    Box(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding()) {
        Column(Modifier.widthIn(max = 520.dp).fillMaxWidth().align(Alignment.Center).padding(24.dp)) {
            AnimatedContent(
                targetState = page,
                transitionSpec = {
                    if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else (slideInHorizontally(tween(320, easing = EaseOutStrong)) { it / 5 } + fadeIn(tween(220))) togetherWith
                        (slideOutHorizontally(tween(260)) { -it / 8 } + fadeOut(tween(160)))
                },
                label = "intro",
            ) { i ->
                val p = pages[i]
                Column {
                    Box(Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(C.OrangeBg), contentAlignment = Alignment.Center) {
                        Icon(p.icon, null, tint = C.Orange, modifier = Modifier.size(30.dp))
                    }
                    Spacer(Modifier.height(22.dp))
                    Text(p.title, style = T.largeTitle)
                    Spacer(Modifier.height(10.dp))
                    Text(p.text, style = T.body.copy(color = C.Muted, fontSize = 16.sp, lineHeight = 23.sp))
                }
            }
            Spacer(Modifier.height(28.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                pages.indices.forEach { i ->
                    Dot(if (i == page) C.Orange else C.Surface3, if (i == page) 10.dp else 8.dp)
                    Spacer(Modifier.width(6.dp))
                }
                Spacer(Modifier.weight(1f))
                if (page < pages.lastIndex) TextButton(onClick = { vm.finishOnboarding() }) { Text("Skip", color = C.Muted) }
            }
            Spacer(Modifier.height(16.dp))
            val last = page == pages.lastIndex
            PrimaryButton(
                when {
                    !last -> "Next"
                    Build.VERSION.SDK_INT >= 33 && !vm.prefs.askedNotificationPermission -> "Allow notifications"
                    else -> "Get started"
                },
                onClick = {
                    if (!last) page++
                    else if (Build.VERSION.SDK_INT >= 33 && !vm.prefs.askedNotificationPermission) {
                        vm.prefs.askedNotificationPermission = true
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else vm.finishOnboarding()
                },
                modifier = Modifier.fillMaxWidth(),
            )
            if (last && Build.VERSION.SDK_INT >= 33 && !vm.prefs.askedNotificationPermission) {
                TextButton(onClick = { vm.finishOnboarding() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Not now", color = C.Muted) }
            }
        }
    }
}
