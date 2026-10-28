package com.plodroid.storeowner.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.LocalReducedMotion
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import com.plodroid.storeowner.ui.theme.bg
import com.plodroid.storeowner.ui.theme.fg

/** Space left at the bottom of scrolling screens so the floating tab bar never hides content. */
val TabBarClearance = 112.dp

/* ── page scaffolding ─────────────────────────────────── */

/** A scrolling top-level page with a large title, like the iOS "large title" pattern. */
@Composable
fun Page(
    title: String,
    subtitle: String? = null,
    action: (@Composable RowScope.() -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(C.Bg),
        contentPadding = PaddingValues(bottom = TabBarClearance),
    ) {
        item("page_header") {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = T.largeTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (subtitle != null) Text(subtitle, style = T.bodyMuted, maxLines = 2)
                }
                if (action != null) Row(verticalAlignment = Alignment.CenterVertically, content = action)
            }
        }
        content()
    }
}

/** Header for pushed screens (with a back arrow). */
@Composable
fun BackHeader(title: String, onBack: () -> Unit, action: (@Composable RowScope.() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().background(C.Bg).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp).heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = C.Text) }
        Text(title, style = T.title, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (action != null) Row(verticalAlignment = Alignment.CenterVertically, content = action)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 22.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text.uppercase(), style = T.section, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** A quiet grouped surface (iOS grouped-list style) holding rows separated by hairlines. */
@Composable
fun Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(C.Surface)
            .border(1.dp, C.Line, RoundedCornerShape(18.dp))
            .animateContentSize(),
        content = content,
    )
}

@Composable
fun Hairline(start: Dp = 16.dp) = HorizontalDivider(Modifier.padding(start = start), thickness = 1.dp, color = C.Line)

/** Tappable row with comfortable touch height and gentle press feedback. */
@Composable
fun RowItem(
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    chevron: Boolean = onClick != null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val bg = if (pressed) C.Surface2 else Color.Transparent
    Row(
        modifier
            .fillMaxWidth()
            .background(bg)
            .then(if (onClick != null) Modifier.clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick) else Modifier)
            .heightIn(min = 56.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(12.dp)) }
        Column(Modifier.weight(1f), content = content)
        if (trailing != null) { Spacer(Modifier.width(8.dp)); trailing() }
        if (chevron) Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = C.Faint, modifier = Modifier.size(20.dp))
    }
}

/* ── small pieces ─────────────────────────────────────── */

@Composable
fun Pill(text: String, tone: Tone = Tone.NEUTRAL, modifier: Modifier = Modifier) {
    Text(
        text,
        style = T.caption.copy(color = tone.fg(), fontWeight = FontWeight.SemiBold, fontSize = 12.sp),
        maxLines = 1,
        modifier = modifier.clip(RoundedCornerShape(50)).background(tone.bg()).padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

@Composable
fun Dot(color: Color, size: Dp = 8.dp) = Box(Modifier.size(size).clip(CircleShape).background(color))

/** Filter chip. Selected = filled + bold, so the state never relies on colour alone. */
@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit, count: Int? = null) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val reduced = LocalReducedMotion.current
    val s by animateFloatAsState(if (pressed && !reduced) 0.96f else 1f, tween(140), label = "chip")
    Row(
        Modifier
            .scale(s)
            .clip(RoundedCornerShape(50))
            .background(if (selected) C.OrangeBg else C.Surface)
            .border(1.dp, if (selected) C.Orange.copy(alpha = 0.55f) else C.Line, RoundedCornerShape(50))
            .clickable(interactionSource = source, indication = null, role = Role.Tab, onClick = onClick)
            .heightIn(min = 38.dp)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = T.label.copy(
                fontSize = 14.sp,
                color = if (selected) C.Text else C.Muted,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            ),
        )
        if (count != null && count > 0) {
            Spacer(Modifier.width(6.dp))
            Text("$count", style = T.caption.copy(color = if (selected) C.Orange else C.Faint, fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
fun ChipRow(content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** Product / category picture, or a calm letter tile when there is no photo. */
@Composable
fun Thumb(url: String?, name: String, size: Dp = 48.dp, corner: Dp = 12.dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(corner)).background(C.Surface2).border(1.dp, C.Line, RoundedCornerShape(corner)),
        contentAlignment = Alignment.Center,
    ) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, style = T.title.copy(color = C.Faint, fontSize = (size.value * 0.38f).sp))
        if (!url.isNullOrBlank()) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/* ── guidance & states ────────────────────────────────── */

/** Blue, dismissible tip. Remembers dismissal via [onDismiss]. */
@Composable
fun Hint(visible: Boolean, text: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    AnimatedVisibility(visible = visible, exit = fadeOut(tween(150)) + shrinkVertically(tween(220))) {
        Row(
            modifier
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(C.BlueBg)
                .border(1.dp, C.Blue.copy(alpha = 0.28f), RoundedCornerShape(16.dp))
                .padding(start = 14.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Filled.Info, contentDescription = null, tint = C.Blue, modifier = Modifier.size(18.dp).padding(top = 1.dp))
            Spacer(Modifier.width(10.dp))
            Text(text, style = T.body.copy(fontSize = 14.sp), modifier = Modifier.weight(1f).padding(top = 0.dp))
            IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Filled.Close, contentDescription = "Dismiss tip", tint = C.Muted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/** Static notice (no dismiss). */
@Composable
fun Notice(text: String, tone: Tone = Tone.BLUE, modifier: Modifier = Modifier) {
    Row(
        modifier
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(tone.bg())
            .border(1.dp, tone.fg().copy(alpha = 0.3f), RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(if (tone == Tone.RED || tone == Tone.ORANGE) Icons.Filled.Warning else Icons.Filled.Info, null, tint = tone.fg(), modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, style = T.body.copy(fontSize = 14.sp))
    }
}

@Composable
fun EmptyState(title: String, text: String, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = T.title.copy(fontSize = 18.sp))
        Spacer(Modifier.height(6.dp))
        Text(text, style = T.bodyMuted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(18.dp)); action() }
    }
}

@Composable
fun LoadingBlock(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = C.Orange, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
fun ErrorBlock(message: String, onRetry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Notice(message, Tone.RED)
        if (onRetry != null) {
            TextButton(onClick = onRetry) {
                Icon(Icons.Filled.Refresh, null, tint = C.Text, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Try again", color = C.Text)
            }
        }
    }
}

/* ── buttons ──────────────────────────────────────────── */

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    tone: Tone = Tone.ORANGE,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val reduced = LocalReducedMotion.current
    val s by animateFloatAsState(if (pressed && !reduced) 0.97f else 1f, tween(140), label = "btn")
    val (bg, fg) = when (tone) {
        Tone.RED -> C.Red to Color(0xFF2B0B08)
        Tone.BLUE -> C.Blue to Color(0xFF0B1A33)
        Tone.GREEN -> C.Green to Color(0xFF0B2414)
        else -> C.Orange to C.OnOrange
    }
    val active = enabled && !busy
    Box(
        modifier
            .scale(s)
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(50))
            .background(if (active || busy) bg else C.Surface3)
            .clickable(enabled = active, interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        else Text(text, style = T.label.copy(color = if (active) fg else C.Faint, fontWeight = FontWeight.SemiBold), maxLines = 1)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, tone: Tone = Tone.NEUTRAL) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val reduced = LocalReducedMotion.current
    val s by animateFloatAsState(if (pressed && !reduced) 0.97f else 1f, tween(140), label = "btn2")
    Box(
        modifier
            .scale(s)
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(50))
            .background(C.Surface2)
            .border(1.dp, C.Line, RoundedCornerShape(50))
            .clickable(enabled = enabled, interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = T.label.copy(color = if (!enabled) C.Faint else if (tone == Tone.NEUTRAL) C.Text else tone.fg()), maxLines = 1)
    }
}

/** Small orange "+ Add" style action used in page headers. */
@Composable
fun HeaderAction(text: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier
            .padding(end = 4.dp)
            .clip(RoundedCornerShape(50))
            .background(C.Orange)
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 40.dp)
            .padding(start = 12.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = C.OnOrange, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, style = T.label.copy(color = C.OnOrange, fontWeight = FontWeight.SemiBold))
    }
}

/* ── inputs ───────────────────────────────────────────── */

@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    help: String? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    prefix: String? = null,
    placeholder: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    enabled: Boolean = true,
    visual: VisualTransformation = VisualTransformation.None,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            label = { Text(label) },
            placeholder = placeholder?.let { { Text(it, color = C.Faint) } },
            prefix = prefix?.let { { Text(it, color = C.Muted) } },
            isError = error != null,
            singleLine = singleLine,
            minLines = minLines,
            enabled = enabled,
            visualTransformation = visual,
            trailingIcon = trailing,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = C.Orange,
                unfocusedBorderColor = C.Line2,
                focusedLabelColor = C.Orange,
                unfocusedLabelColor = C.Muted,
                cursorColor = C.Orange,
                focusedContainerColor = C.Surface,
                unfocusedContainerColor = C.Surface,
                errorBorderColor = C.Red,
                errorLabelColor = C.Red,
                focusedTextColor = C.Text,
                unfocusedTextColor = C.Text,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        val note = error ?: help
        if (note != null) {
            Text(note, style = T.caption.copy(color = if (error != null) C.Red else C.Faint, fontSize = 13.sp), modifier = Modifier.padding(start = 4.dp, top = 4.dp))
        }
    }
}

@Composable
fun SwitchRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Switch) { onChange(!checked) }
            .heightIn(min = 56.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = T.label)
            if (subtitle != null) Text(subtitle, style = T.caption.copy(fontSize = 13.sp))
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,   // whole row is the tap target
            enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = C.OnOrange,
                checkedTrackColor = C.Orange,
                uncheckedThumbColor = C.Muted,
                uncheckedTrackColor = C.Surface3,
                uncheckedBorderColor = C.Line2,
            ),
        )
    }
}

/* ── dialogs ──────────────────────────────────────────── */

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    dismiss: String = "Cancel",
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = C.Surface2,
        titleContentColor = C.Text,
        textContentColor = C.Muted,
        title = { Text(title, style = T.title) },
        text = { Text(text, style = T.body.copy(color = C.Muted)) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirm, color = if (destructive) C.Red else C.Orange, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(dismiss, color = C.Text) } },
    )
}

@Composable
fun Stars(rating: Int?, size: Dp = 16.dp) {
    if (rating == null) return
    Row {
        repeat(5) { i ->
            Icon(
                Icons.Filled.Star,
                contentDescription = null,
                tint = if (i < rating) C.Star else C.Surface3,
                modifier = Modifier.size(size),
            )
        }
    }
}

@Composable
fun Centered(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 520.dp), content = content)
    }
}
