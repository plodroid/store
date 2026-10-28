package com.plodroid.storeowner.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.EaseOutStrong
import com.plodroid.storeowner.ui.theme.LocalReducedMotion
import com.plodroid.storeowner.ui.theme.T
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Stacked daily bars: real orders (solid) with test orders on top (faint). Readable on small phones. */
@Composable
fun DailyBars(
    days: List<Long>,
    real: List<Int>,
    test: List<Int>,
    description: String,
    modifier: Modifier = Modifier,
) {
    val reduced = LocalReducedMotion.current
    val grow = remember(days.size) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(days.size, real, test) {
        if (!reduced) { grow.snapTo(0f); grow.animateTo(1f, tween(520, easing = EaseOutStrong)) }
    }
    val maxV = maxOf(1, (real.indices).maxOfOrNull { real[it] + test.getOrElse(it) { 0 } } ?: 1)
    val fmt = remember { SimpleDateFormat("d MMM", Locale.UK) }

    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$maxV", style = T.caption, modifier = Modifier.width(24.dp))
            Spacer(Modifier.width(4.dp))
            Canvas(
                Modifier.weight(1f).height(120.dp).semantics { contentDescription = description },
            ) {
                val n = days.size.coerceAtLeast(1)
                val gap = if (n > 14) 2.dp.toPx() else 6.dp.toPx()
                val w = ((size.width - gap * (n - 1)) / n).coerceAtLeast(1f)
                val r = CornerRadius(minOf(w / 2, 4.dp.toPx()))
                // baseline + mid grid line
                drawLine(C.Line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                drawLine(C.Line, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 1.dp.toPx())
                for (i in 0 until n) {
                    val x = i * (w + gap)
                    val rv = real.getOrElse(i) { 0 }
                    val tv = test.getOrElse(i) { 0 }
                    val hReal = size.height * rv / maxV * grow.value
                    val hTest = size.height * tv / maxV * grow.value
                    if (rv == 0 && tv == 0) {
                        drawRoundRect(C.Surface3, Offset(x, size.height - 2.dp.toPx()), Size(w, 2.dp.toPx()), r)
                    }
                    if (hReal > 0) drawRoundRect(C.Orange, Offset(x, size.height - hReal), Size(w, hReal), r)
                    if (hTest > 0) drawRoundRect(C.Blue.copy(alpha = 0.45f), Offset(x, size.height - hReal - hTest), Size(w, hTest), r)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 28.dp, top = 6.dp)) {
            if (days.isNotEmpty()) {
                Text(fmt.format(Date(days.first())), style = T.caption, modifier = Modifier.weight(1f))
                if (days.size > 2) Text(fmt.format(Date(days[days.size / 2])), style = T.caption, modifier = Modifier.weight(1f))
                Text("Today", style = T.caption)
            }
        }
        Row(Modifier.padding(start = 28.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Dot(C.Orange); Spacer(Modifier.width(6.dp)); Text("Real orders", style = T.caption)
            Spacer(Modifier.width(16.dp))
            Dot(C.Blue.copy(alpha = 0.6f)); Spacer(Modifier.width(6.dp)); Text("Test orders", style = T.caption)
        }
    }
}
