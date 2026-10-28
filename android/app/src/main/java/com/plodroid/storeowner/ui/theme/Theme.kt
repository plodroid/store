package com.plodroid.storeowner.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Same dark charcoal family as the website. The owner app adds meaning-colours:
 *   orange = main actions + highlights, red = errors/destructive/sold out,
 *   blue = tips and guidance, green = success/healthy.
 */
object C {
    val Bg = Color(0xFF151515)
    val Surface = Color(0xFF1E1E1E)
    val Surface2 = Color(0xFF262626)
    val Surface3 = Color(0xFF303030)
    val Line = Color(0x17FFFFFF)
    val Line2 = Color(0x29FFFFFF)

    val Text = Color(0xFFECEDEE)
    val Muted = Color(0xFFA6AAB0)
    val Faint = Color(0xFF7D8187)

    val Blue = Color(0xFF8AB4F8)
    val BlueBg = Color(0x1A8AB4F8)
    val Orange = Color(0xFFFF9E4F)
    val OnOrange = Color(0xFF1F1205)
    val OrangeBg = Color(0x24FF9E4F)
    val Red = Color(0xFFF28B82)
    val RedBg = Color(0x22F28B82)
    val Green = Color(0xFF81C995)
    val GreenBg = Color(0x2281C995)
    val Star = Color(0xFFF3C969)
}

enum class Tone { NEUTRAL, BLUE, ORANGE, RED, GREEN }

fun Tone.fg(): Color = when (this) {
    Tone.NEUTRAL -> C.Muted
    Tone.BLUE -> C.Blue
    Tone.ORANGE -> C.Orange
    Tone.RED -> C.Red
    Tone.GREEN -> C.Green
}

fun Tone.bg(): Color = when (this) {
    Tone.NEUTRAL -> C.Surface3
    Tone.BLUE -> C.BlueBg
    Tone.ORANGE -> C.OrangeBg
    Tone.RED -> C.RedBg
    Tone.GREEN -> C.GreenBg
}

/** Same "strong ease-out" curve the website uses. */
val EaseOutStrong = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

/** True when the phone's animations are switched off (Developer options or accessibility). */
val LocalReducedMotion = staticCompositionLocalOf { false }

object T {
    val largeTitle = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.6).sp, color = C.Text)
    val title = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp, color = C.Text)
    val section = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = C.Muted, letterSpacing = 0.2.sp)
    val body = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, color = C.Text)
    val bodyMuted = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, color = C.Muted)
    val label = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, color = C.Text)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, color = C.Faint)
    val number = TextStyle(fontSize = 26.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp, color = C.Text, fontFeatureSettings = "tnum")
    val numberSmall = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, color = C.Text, fontFeatureSettings = "tnum")
}

@Composable
fun OwnerTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val reduced = remember {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
    val scheme = darkColorScheme(
        primary = C.Orange,
        onPrimary = C.OnOrange,
        secondary = C.Blue,
        onSecondary = Color(0xFF0B1A33),
        background = C.Bg,
        onBackground = C.Text,
        surface = C.Surface,
        onSurface = C.Text,
        surfaceVariant = C.Surface2,
        onSurfaceVariant = C.Muted,
        outline = C.Line2,
        outlineVariant = C.Line,
        error = C.Red,
        onError = Color(0xFF2B0B08),
    )
    CompositionLocalProvider(LocalReducedMotion provides reduced) {
        MaterialTheme(colorScheme = scheme, typography = Typography(), content = content)
    }
}
