package com.plodroid.storeowner.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import com.plodroid.storeowner.data.CategoryRemoval
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.data.PreparedImage
import com.plodroid.storeowner.domain.Category
import com.plodroid.storeowner.domain.Validation
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.components.BackHeader
import com.plodroid.storeowner.ui.components.ConfirmDialog
import com.plodroid.storeowner.ui.components.EmptyState
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Field
import com.plodroid.storeowner.ui.components.Group
import com.plodroid.storeowner.ui.components.Hairline
import com.plodroid.storeowner.ui.components.HeaderAction
import com.plodroid.storeowner.ui.components.Hint
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.Notice
import com.plodroid.storeowner.ui.components.Pill
import com.plodroid.storeowner.ui.components.PrimaryButton
import com.plodroid.storeowner.ui.components.RowItem
import com.plodroid.storeowner.ui.components.SecondaryButton
import com.plodroid.storeowner.ui.components.SwitchRow
import com.plodroid.storeowner.ui.components.Thumb
import com.plodroid.storeowner.ui.plural
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.launch

@Composable
fun CategoriesScreen(vm: OwnerViewModel, nav: NavHostController) {
    val categories by vm.categories.collectAsStateWithLifecycle()
    val products by vm.products.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<Category?>(null) }
    var creating by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Category?>(null) }
    var moving by remember { mutableStateOf(false) }

    val cats = categories.getOrNull().orEmpty().sortedBy { it.sortOrder }
    val counts = products.getOrNull().orEmpty().filter { !it.archived }.groupingBy { it.categoryId }.eachCount()

    Column(Modifier.fillMaxSize().background(C.Bg)) {
        BackHeader("Categories", onBack = { nav.popBackStack() }) {
            HeaderAction("Add", Icons.Filled.Add) { creating = true }
        }
        LazyColumn(Modifier.weight(1f)) {
            item {
                Hint(
                    visible = "categories" !in hints,
                    text = "Categories are the tabs customers use to browse your website, like \"Drinks\" or \"Snacks\". Use the arrows to change their order.",
                    onDismiss = { vm.dismissHint("categories") },
                )
            }
            when (val l = categories) {
                is Loadable.Loading -> item { LoadingBlock() }
                is Loadable.Failed -> item { ErrorBlock(l.message) }
                is Loadable.Ready -> {
                    if (cats.isEmpty()) {
                        item {
                            EmptyState("No categories yet", "Add your first one — it becomes a tab on your website that customers can tap.") {
                                PrimaryButton("Add a category", onClick = { creating = true })
                            }
                        }
                    } else item {
                        Group(Modifier.padding(top = 8.dp)) {
                            cats.forEachIndexed { i, c ->
                                if (i > 0) Hairline(76.dp)
                                RowItem(
                                    onClick = { editing = c },
                                    leading = { Thumb(c.image, c.name, 44.dp) },
                                    chevron = false,
                                    trailing = {
                                        Row {
                                            IconButton(onClick = { moving = true; scope.launch { vm.act(null) { it.moveCategory(c.id, up = true) }; moving = false } }, enabled = i > 0 && !moving) {
                                                Icon(Icons.Filled.KeyboardArrowUp, "Move ${c.name} up", tint = if (i > 0) C.Text else C.Surface3)
                                            }
                                            IconButton(onClick = { moving = true; scope.launch { vm.act(null) { it.moveCategory(c.id, up = false) }; moving = false } }, enabled = i < cats.lastIndex && !moving) {
                                                Icon(Icons.Filled.KeyboardArrowDown, "Move ${c.name} down", tint = if (i < cats.lastIndex) C.Text else C.Surface3)
                                            }
                                        }
                                    },
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(c.name, style = T.label)
                                        if (!c.visible) { Spacer(Modifier.width(6.dp)); Pill("Hidden", Tone.NEUTRAL) }
                                    }
                                    Text(plural(counts[c.id] ?: 0, "product"), style = T.caption.copy(fontSize = 13.sp))
                                }
                            }
                        }
                    }
                    val loose = counts[null] ?: 0
                    if (loose > 0) item {
                        Text("${plural(loose, "product")} not in any category — customers still see them under \"All\".", style = T.caption, modifier = Modifier.padding(20.dp))
                    }
                }
            }
            item { Spacer(Modifier.height(40.dp)) }
        }
    }

    if (creating || editing != null) {
        CategoryDialog(vm, editing, onDelete = { c -> editing = null; removing = c }, onDone = { creating = false; editing = null })
    }
    removing?.let { c ->
        RemoveCategoryDialog(vm, c, cats.filter { it.id != c.id }, counts[c.id] ?: 0, onDone = { removing = null })
    }
}

@Composable
private fun DialogFrame(content: @Composable () -> Unit) {
    Column(
        Modifier.widthIn(max = 480.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(C.Surface2)
            .border(1.dp, C.Line2, RoundedCornerShape(24.dp)).verticalScroll(rememberScrollState()).padding(vertical = 18.dp),
    ) { content() }
}

@Composable
private fun CategoryDialog(vm: OwnerViewModel, cat: Category?, onDelete: (Category) -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(cat?.name.orEmpty()) }
    var desc by remember { mutableStateOf(cat?.description.orEmpty()) }
    var visible by remember { mutableStateOf(cat?.visible ?: true) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var image by remember { mutableStateOf<PreparedImage?>(null) }
    var preview by remember { mutableStateOf<Uri?>(null) }
    var removeImage by remember { mutableStateOf(false) }
    var confirmClose by remember { mutableStateOf(false) }
    val dirty = name != cat?.name.orEmpty() || desc != cat?.description.orEmpty() || visible != (cat?.visible ?: true) || image != null || removeImage

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            val img = vm.prepareImage(uri)
            if (img != null) { image = img; preview = uri; removeImage = false }
        }
    }

    Dialog(onDismissRequest = { if (!saving) { if (dirty) confirmClose = true else onDone() } }) {
        DialogFrame {
            Text(if (cat == null) "New category" else "Edit category", style = T.title, modifier = Modifier.padding(horizontal = 18.dp))
            Spacer(Modifier.height(8.dp))
            Field("Name customers will see", name, { name = it.take(60); error = null }, error = error)
            Field("Description (optional)", desc, { desc = it.take(300) }, singleLine = false, minLines = 2)
            SwitchRow("Show on website", if (visible) "Shown as a tab in your shop" else "Hidden — its products are hidden too", visible, { visible = it })
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                val shown: Any? = preview ?: cat?.image?.takeIf { !removeImage }
                Box(
                    Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Line, RoundedCornerShape(14.dp))
                        .clickable(role = Role.Button) { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (shown != null) AsyncImage(model = shown, contentDescription = "Category picture", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    else Text("+", style = T.title.copy(color = C.Muted))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Picture (optional)", style = T.label)
                    if (shown != null) TextButton(onClick = { image = null; preview = null; removeImage = cat?.image != null }) { Text("Remove picture", color = C.Red) }
                }
            }
            PrimaryButton(
                if (cat == null) "Add category" else "Save",
                busy = saving,
                enabled = dirty || cat == null,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp).fillMaxWidth(),
                onClick = {
                    val problem = Validation.categoryName(name)
                    if (problem != null) { error = problem; return@PrimaryButton }
                    saving = true
                    scope.launch {
                        val ok = vm.act(if (cat == null) "Category added — it's a tab on your website now" else "Category saved") {
                            it.saveCategory(cat?.id, name, desc, visible, image, removeImage)
                        }
                        saving = false
                        if (ok != null) onDone()
                    }
                },
            )
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                if (cat != null) TextButton(onClick = { onDelete(cat) }, enabled = !saving) { Text("Delete category", color = C.Red) } else Spacer(Modifier.width(1.dp))
                TextButton(onClick = { if (dirty) confirmClose = true else onDone() }, enabled = !saving) { Text("Cancel", color = C.Muted) }
            }
        }
    }
    if (confirmClose) {
        ConfirmDialog("Discard changes?", "This category hasn't been saved.", "Discard", onConfirm = { confirmClose = false; onDone() }, onDismiss = { confirmClose = false }, destructive = true, dismiss = "Keep editing")
    }
}

@Composable
private fun RemoveCategoryDialog(vm: OwnerViewModel, cat: Category, others: List<Category>, productCount: Int, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    // "move:<id>", "move:" (no category) or "archive"
    var choice by remember { mutableStateOf("move:") }
    var busy by remember { mutableStateOf(false) }

    if (productCount == 0) {
        ConfirmDialog(
            "Delete \"${cat.name}\"?",
            "It has no products, so nothing else changes. The tab disappears from your website.",
            "Delete", destructive = true,
            onConfirm = { scope.launch { vm.act("Category deleted") { it.deleteCategory(cat.id, CategoryRemoval.MoveTo(null)) }; onDone() } },
            onDismiss = onDone,
        )
        return
    }

    Dialog(onDismissRequest = { if (!busy) onDone() }) {
        DialogFrame {
            Text("Delete \"${cat.name}\"?", style = T.title, modifier = Modifier.padding(horizontal = 18.dp))
            Spacer(Modifier.height(6.dp))
            Text(
                "It still has ${plural(productCount, "product")}. Choose what happens to ${if (productCount == 1) "it" else "them"} — nothing is deleted.",
                style = T.bodyMuted, modifier = Modifier.padding(horizontal = 18.dp),
            )
            Spacer(Modifier.height(10.dp))
            Option("Move to \"No category\"", "They stay on sale under \"All\".", choice == "move:") { choice = "move:" }
            others.forEach { o -> Option("Move to \"${o.name}\"", null, choice == "move:${o.id}") { choice = "move:${o.id}" } }
            Option("Remove them from sale", "They're hidden from customers. You can put them back later.", choice == "archive") { choice = "archive" }
            Notice("This can't be undone, but the products themselves are kept.", Tone.ORANGE)
            Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Cancel", onClick = onDone, enabled = !busy, modifier = Modifier.weight(1f))
                PrimaryButton(
                    "Delete category", tone = Tone.RED, busy = busy, modifier = Modifier.weight(1f),
                    onClick = {
                        busy = true
                        val removal = if (choice == "archive") CategoryRemoval.ArchiveProducts
                        else CategoryRemoval.MoveTo(choice.removePrefix("move:").ifEmpty { null })
                        scope.launch {
                            val ok = vm.act("Category deleted") { it.deleteCategory(cat.id, removal) }
                            busy = false
                            if (ok != null) onDone()
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun Option(title: String, subtitle: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected = selected, role = Role.RadioButton, onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = C.Orange, unselectedColor = C.Muted))
        Spacer(Modifier.width(8.dp))
        Column {
            Text(title, style = T.label)
            if (subtitle != null) Text(subtitle, style = T.caption.copy(fontSize = 13.sp))
        }
    }
}

