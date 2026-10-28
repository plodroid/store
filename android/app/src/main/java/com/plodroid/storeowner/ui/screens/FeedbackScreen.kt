package com.plodroid.storeowner.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.domain.Feedback
import com.plodroid.storeowner.ui.Fmt
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.Routes
import com.plodroid.storeowner.ui.components.BackHeader
import com.plodroid.storeowner.ui.components.Chip
import com.plodroid.storeowner.ui.components.ChipRow
import com.plodroid.storeowner.ui.components.Dot
import com.plodroid.storeowner.ui.components.EmptyState
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Group
import com.plodroid.storeowner.ui.components.Hairline
import com.plodroid.storeowner.ui.components.Hint
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.Page
import com.plodroid.storeowner.ui.components.RowItem
import com.plodroid.storeowner.ui.components.SecondaryButton
import com.plodroid.storeowner.ui.components.Stars
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.launch

enum class FeedbackFilter(val label: String) { UNREAD("Unread"), ALL("All"), ARCHIVED("Archived") }

@Composable
fun FeedbackScreen(vm: OwnerViewModel, nav: NavHostController) {
    val feedback by vm.feedback.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    val all = feedback.getOrNull().orEmpty()
    val unread = all.count { !it.read && !it.archived }
    var filter by rememberSaveable { mutableStateOf(if (unread > 0) FeedbackFilter.UNREAD else FeedbackFilter.ALL) }
    val shown = all.filter {
        when (filter) {
            FeedbackFilter.UNREAD -> !it.read && !it.archived
            FeedbackFilter.ALL -> !it.archived
            FeedbackFilter.ARCHIVED -> it.archived
        }
    }

    Page(title = "Feedback", subtitle = if (unread > 0) "$unread unread" else null) {
        item("hint") {
            Hint(
                visible = "feedback" !in hints,
                text = "Messages customers send from your website land here. Only you can see them — they're never published.",
                onDismiss = { vm.dismissHint("feedback") },
            )
        }
        when (val l = feedback) {
            is Loadable.Loading -> { item("load") { LoadingBlock() }; return@Page }
            is Loadable.Failed -> { item("err") { ErrorBlock(l.message) }; return@Page }
            is Loadable.Ready -> Unit
        }
        if (all.isEmpty()) {
            item("empty") { EmptyState("No feedback yet", "When customers use \"Send feedback\" on your website, their messages appear here.") }
            return@Page
        }
        item("filters") {
            ChipRow { FeedbackFilter.entries.forEach { f -> Chip(f.label, filter == f, { filter = f }, count = if (f == FeedbackFilter.UNREAD) unread else null) } }
        }
        if (shown.isEmpty()) {
            item("none") { EmptyState(if (filter == FeedbackFilter.UNREAD) "All read" else "Nothing here", if (filter == FeedbackFilter.UNREAD) "You've read every message." else "No messages in this list.") }
        } else item("list") {
            Group(Modifier.padding(top = 6.dp)) {
                shown.forEachIndexed { i, f ->
                    if (i > 0) Hairline(36.dp)
                    FeedbackRow(f) { nav.navigate(Routes.feedbackItem(f.id)) }
                }
            }
        }
    }
}

@Composable
private fun FeedbackRow(f: Feedback, onClick: () -> Unit) {
    RowItem(onClick = onClick, leading = { Dot(if (!f.read && !f.archived) C.Orange else C.Surface3) }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Stars(f.rating, 14.dp)
            if (f.rating != null) Spacer(Modifier.width(8.dp))
            Text(Fmt.ago(f.createdAt), style = T.caption)
        }
        Text(f.message, style = T.body.copy(fontWeight = if (f.read) FontWeight.Normal else FontWeight.Medium), maxLines = 2)
        val who = listOfNotNull(f.name.ifBlank { null }, f.orderRef).joinToString(" · ")
        if (who.isNotEmpty()) Text(who, style = T.caption)
    }
}

@Composable
fun FeedbackDetailScreen(vm: OwnerViewModel, nav: NavHostController, id: String) {
    val feedback by vm.feedback.collectAsStateWithLifecycle()
    val f = feedback.getOrNull()?.firstOrNull { it.id == id }
    val scope = rememberCoroutineScope()

    // Opening a message marks it as read.
    LaunchedEffect(f?.id, f?.read) {
        if (f != null && !f.read) vm.act(null) { it.setFeedbackRead(f.id, true) }
    }

    Column(Modifier.fillMaxSize().background(C.Bg)) {
        BackHeader("Feedback", onBack = { nav.popBackStack() })
        when {
            feedback is Loadable.Loading -> { LoadingBlock(); return@Column }
            f == null -> { ErrorBlock("This message can't be found."); return@Column }
        }
        val fb = f!!
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp)) {
            Stars(fb.rating, 22.dp)
            if (fb.rating != null) Spacer(Modifier.height(12.dp))
            Text(fb.message, style = T.body.copy(fontSize = 17.sp, lineHeight = 25.sp))
            Spacer(Modifier.height(18.dp))
            Text(fb.name.ifBlank { "No name given" }, style = T.label)
            Text("Sent ${Fmt.full(fb.createdAt)}", style = T.caption)
            if (fb.orderRef != null) {
                Spacer(Modifier.height(14.dp))
                if (fb.orderId != null) {
                    SecondaryButton("Open order ${fb.orderRef}", onClick = { nav.navigate(Routes.order(fb.orderId)) })
                } else {
                    Text("Order reference ${fb.orderRef} (not found in your orders)", style = T.caption)
                }
            }
            Spacer(Modifier.height(28.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton(
                    if (fb.read) "Mark as unread" else "Mark as read",
                    onClick = { scope.launch { vm.act(null) { it.setFeedbackRead(fb.id, !fb.read) } } },
                    modifier = Modifier.weight(1f),
                )
                SecondaryButton(
                    if (fb.archived) "Move back to inbox" else "Archive",
                    tone = if (fb.archived) Tone.NEUTRAL else Tone.ORANGE,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        scope.launch {
                            val ok = vm.act(if (fb.archived) "Moved back to inbox" else "Archived") { it.setFeedbackArchived(fb.id, !fb.archived) }
                            if (ok != null && !fb.archived) nav.popBackStack()
                        }
                    },
                )
            }
        }
    }
}
