package com.plodroid.storeowner.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.EaseOutStrong
import com.plodroid.storeowner.ui.theme.LocalReducedMotion

data class TabSpec(val route: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

/**
 * Floating "liquid glass" tab bar: a translucent charcoal pill with a specular top edge,
 * soft shadow and a hairline border. The selected tab gets a filled icon, a tinted pill
 * and a bold label — so it's obvious without relying on colour.
 */
@Composable
fun GlassTabBar(
    tabs: List<TabSpec>,
    current: String?,
    badges: Map<String, Int>,
    onSelect: (TabSpec) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(30.dp)
    Box(modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .shadow(28.dp, shape, ambientColor = Color.Black, spotColor = Color.Black)
                .clip(shape)
                .background(Brush.verticalGradient(listOf(Color(0xF02B2B2B), Color(0xF51E1E1E))))
                .border(1.dp, Brush.verticalGradient(listOf(Color(0x38FFFFFF), Color(0x0DFFFFFF))), shape)
                .padding(5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tabs.forEach { tab ->
                TabButton(tab, selected = tab.route == current, badge = badges[tab.route] ?: 0, onClick = { onSelect(tab) }, modifier = Modifier.weight(1f))
            }
        }
        // specular highlight along the top edge
        Canvas(Modifier.widthIn(max = 560.dp).fillMaxWidth().height(1.dp).padding(horizontal = 40.dp).align(Alignment.TopCenter).offset(y = 0.dp)) {
            drawLine(
                Brush.horizontalGradient(listOf(Color.Transparent, Color(0x66FFFFFF), Color.Transparent)),
                Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1.dp.toPx(),
            )
        }
    }
}

@Composable
private fun TabButton(tab: TabSpec, selected: Boolean, badge: Int, onClick: () -> Unit, modifier: Modifier) {
    val reduced = LocalReducedMotion.current
    val dur = if (reduced) 0 else 220
    val bg by animateColorAsState(if (selected) C.OrangeBg else Color.Transparent, tween(dur, easing = EaseOutStrong), label = "tabBg")
    val fg by animateColorAsState(if (selected) C.Orange else C.Muted, tween(dur), label = "tabFg")
    val s by animateFloatAsState(if (selected && !reduced) 1f else 0.96f, tween(dur, easing = EaseOutStrong), label = "tabScale")
    val desc = tab.label + if (badge > 0) ", $badge new" else ""
    Column(
        modifier
            .clip(RoundedCornerShape(24.dp))
            .background(bg)
            .selectable(selected = selected, onClick = onClick, role = Role.Tab, interactionSource = remember { MutableInteractionSource() }, indication = null)
            .semantics { contentDescription = desc }
            .heightIn(min = 54.dp)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            Icon(if (selected) tab.selectedIcon else tab.icon, contentDescription = null, tint = fg, modifier = Modifier.size(23.dp).scale(s))
            if (badge > 0) {
                Box(
                    Modifier.align(Alignment.TopEnd).offset(x = 9.dp, y = (-4).dp)
                        .clip(CircleShape).background(C.Red).border(1.5.dp, C.Surface, CircleShape)
                        .padding(horizontal = 4.dp, vertical = 0.dp)
                        .heightIn(min = 16.dp).widthIn(min = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (badge > 99) "99+" else "$badge", fontSize = 10.sp, lineHeight = 14.sp, color = Color(0xFF2B0B08), fontWeight = FontWeight.Bold)
                }
            }
        }
        Spacer(Modifier.height(2.dp))
        Text(
            tab.label,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = if (selected) C.Text else C.Muted,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}
