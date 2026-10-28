package com.plodroid.storeowner.ui.screens

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import com.plodroid.storeowner.data.DeleteOutcome
import com.plodroid.storeowner.data.PreparedImage
import com.plodroid.storeowner.domain.Analytics
import com.plodroid.storeowner.domain.Category
import com.plodroid.storeowner.domain.Checked
import com.plodroid.storeowner.domain.Money
import com.plodroid.storeowner.domain.ProductForm
import com.plodroid.storeowner.domain.Validation
import com.plodroid.storeowner.ui.Fmt
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.components.BackHeader
import com.plodroid.storeowner.ui.components.ConfirmDialog
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Field
import com.plodroid.storeowner.ui.components.Group
import com.plodroid.storeowner.ui.components.Hairline
import com.plodroid.storeowner.ui.components.Hint
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.PrimaryButton
import com.plodroid.storeowner.ui.components.SecondaryButton
import com.plodroid.storeowner.ui.components.SectionTitle
import com.plodroid.storeowner.ui.components.SwitchRow
import com.plodroid.storeowner.ui.components.Chip
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.launch

/** Form state that survives screen rotation (scoped to this screen). */
class ProductEditorState : ViewModel() {
    var initialized by mutableStateOf(false)
    var loadFailed by mutableStateOf<String?>(null)
    var initial by mutableStateOf(ProductForm())
    var form by mutableStateOf(ProductForm())
    var errors by mutableStateOf<Map<String, String>>(emptyMap())
    var image by mutableStateOf<PreparedImage?>(null)
    var preview by mutableStateOf<Uri?>(null)
    var removeImage by mutableStateOf(false)
    var preparing by mutableStateOf(false)
    var saving by mutableStateOf(false)
    var showMore by mutableStateOf(false)

    fun start(f: ProductForm) { initial = f; form = f; initialized = true; showMore = f.sku.isNotEmpty() || f.barcode.isNotEmpty() || f.cost.isNotEmpty() || f.lowStock.isNotEmpty() || f.unit.isNotEmpty() }
    val dirty: Boolean get() = form != initial || image != null || removeImage
    fun edit(change: (ProductForm) -> ProductForm, field: String) { form = change(form); if (field in errors) errors = errors - field }
}

private val UNITS = listOf("each", "bottle", "pack", "kg")

@Composable
fun ProductEditScreen(vm: OwnerViewModel, nav: NavHostController, id: String?) {
    val ed: ProductEditorState = viewModel()
    val products by vm.products.collectAsStateWithLifecycle()
    val categories by vm.categories.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val existing = id?.let { pid -> products.getOrNull()?.firstOrNull { it.id == pid } }
    val cats = categories.getOrNull().orEmpty().sortedBy { it.sortOrder }
    var confirmLeave by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }

    // Load the form once (and the owner-only fields for an existing product).
    LaunchedEffect(id, existing != null, attempt) {
        if (ed.initialized) return@LaunchedEffect
        if (id == null) { ed.start(ProductForm(visible = true)); return@LaunchedEffect }
        if (existing == null) return@LaunchedEffect
        ed.loadFailed = null
        val priv = vm.act(null) { it.productPrivate(id) }
        if (priv == null) ed.loadFailed = "Couldn't load this product's private details (cost price, codes). Check your connection and try again."
        else ed.start(ProductForm.from(existing, priv))
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            ed.preparing = true
            val img = vm.prepareImage(uri)
            if (img != null) { ed.image = img; ed.preview = uri; ed.removeImage = false }
            ed.preparing = false
        }
    }

    fun leave() { if (ed.dirty && !ed.saving) confirmLeave = true else nav.popBackStack() }
    BackHandler(enabled = ed.dirty && !ed.saving) { confirmLeave = true }

    fun save() {
        when (val c = Validation.product(ed.form)) {
            is Checked.Problems -> {
                ed.errors = c.byField
                vm.say("Please fix the highlighted fields.", true)
            }
            is Checked.Ok -> scope.launch {
                ed.saving = true
                val msg = when {
                    id == null && c.value.visible -> "Product added — it's on your website now"
                    id == null -> "Product added (hidden from your website)"
                    else -> "Saved — your website is updated"
                }
                val savedId = vm.act(msg) { it.saveProduct(id, c.value, ed.image, ed.removeImage) }
                ed.saving = false
                if (savedId != null) { ed.initial = ed.form; ed.image = null; ed.removeImage = false; nav.popBackStack() }
            }
        }
    }

    Column(Modifier.fillMaxSize().background(C.Bg)) {
        BackHeader(if (id == null) "New product" else "Edit product", onBack = { leave() }) {
            TextButton(onClick = { save() }, enabled = ed.initialized && !ed.saving && (ed.dirty || id == null)) {
                if (ed.saving) CircularProgressIndicator(color = C.Orange, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                else Text("Save", color = if (ed.dirty || id == null) C.Orange else C.Faint, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
        }

        when {
            ed.loadFailed != null -> { ErrorBlock(ed.loadFailed!!) { ed.loadFailed = null; attempt++ }; return@Column }
            id != null && existing == null && products.getOrNull() != null -> {
                ErrorBlock("This product no longer exists. It may have been deleted on another phone."); return@Column
            }
            !ed.initialized -> { LoadingBlock(); return@Column }
        }

        val f = ed.form
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Hint(
                visible = "productEdit" !in hints,
                text = "Only the name, price and stock are required. Everything else is optional — you can add it later.",
                onDismiss = { vm.dismissHint("productEdit") },
            )

            // ── photo ────────────────────────────────
            SectionTitle("Photo")
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                val shown: Any? = ed.preview ?: existing?.image?.takeIf { !ed.removeImage }
                Box(
                    Modifier.size(112.dp).clip(RoundedCornerShape(18.dp)).background(C.Surface2).border(1.dp, C.Line, RoundedCornerShape(18.dp))
                        .clickable(role = Role.Button, onClickLabel = "Choose photo") { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (ed.preparing) CircularProgressIndicator(color = C.Orange, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                    else if (shown != null) AsyncImage(model = shown, contentDescription = "Product photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    else Text("Add\nphoto", style = T.caption.copy(color = C.Muted, fontSize = 13.sp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
                Spacer(Modifier.width(14.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryButton(if (shown != null) "Replace photo" else "Choose photo", onClick = {
                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    })
                    if (shown != null) SecondaryButton("Remove photo", tone = Tone.RED, onClick = {
                        ed.image = null; ed.preview = null; ed.removeImage = existing?.image != null
                    })
                    Text("JPG, PNG or WebP. We shrink big photos for you.", style = T.caption)
                }
            }

            // ── essentials ───────────────────────────
            SectionTitle("Details")
            Field("Name", f.name, { v -> ed.edit({ it.copy(name = v) }, "name") }, error = ed.errors["name"])
            Row {
                Field(
                    "Price", f.price, { v -> ed.edit({ it.copy(price = v.filter { c -> c.isDigit() || c == '.' }.take(9)) }, "price") },
                    modifier = Modifier.weight(1f), prefix = "£", keyboard = KeyboardType.Decimal, error = ed.errors["price"],
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Field(
                    "Stock (how many you have)", f.stock, { v -> ed.edit({ it.copy(stock = v.filter { c -> c.isDigit() }.take(7)) }, "stock") },
                    modifier = Modifier.weight(1f), keyboard = KeyboardType.Number, error = ed.errors["stock"],
                )
                val n = Validation.parseWhole(f.stock, Validation.MAX_STOCK) ?: 0
                StepButton("−", "Remove one", enabled = n > 0) { ed.edit({ it.copy(stock = (n - 1).coerceAtLeast(0).toString()) }, "stock") }
                Spacer(Modifier.width(8.dp))
                StepButton("+", "Add one") { ed.edit({ it.copy(stock = (n + 1).toString()) }, "stock") }
                Spacer(Modifier.width(16.dp))
            }
            CategoryPicker(cats, f.categoryId) { v -> ed.edit({ it.copy(categoryId = v) }, "categoryId") }
            Field(
                "Short description (optional)", f.description, { v -> ed.edit({ it.copy(description = v.take(2000)) }, "description") },
                singleLine = false, minLines = 3, error = ed.errors["description"],
            )

            Spacer(Modifier.height(8.dp))
            Group {
                SwitchRow("Show on website", if (f.visible) "Customers can see and buy it" else "Hidden — only you can see it", f.visible, { v -> ed.edit({ it.copy(visible = v) }, "visible") })
                Hairline(0.dp)
                SwitchRow("Feature it", "Shows near the top of your shop", f.featured, { v -> ed.edit({ it.copy(featured = v) }, "featured") })
            }

            // ── optional extras ──────────────────────
            Row(
                Modifier.padding(top = 18.dp).fillMaxWidth().clickable(role = Role.Button) { ed.showMore = !ed.showMore }.heightIn(min = 48.dp).padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("More details (optional)", style = T.label.copy(color = C.Muted), modifier = Modifier.weight(1f))
                Icon(if (ed.showMore) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, null, tint = C.Muted)
            }
            AnimatedVisibility(ed.showMore) {
                Column {
                    Text("Sold by", style = T.caption.copy(fontSize = 13.sp), modifier = Modifier.padding(start = 20.dp, top = 6.dp))
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        UNITS.forEach { u -> Chip(u, f.unit == u, { ed.edit({ it.copy(unit = if (it.unit == u) "" else u) }, "unit") }) }
                    }
                    Field("Or type your own (e.g. box of 6)", if (f.unit in UNITS) "" else f.unit, { v -> ed.edit({ it.copy(unit = v.take(30)) }, "unit") }, error = ed.errors["unit"])
                    Field(
                        "Warn me when stock falls to", f.lowStock, { v -> ed.edit({ it.copy(lowStock = v.filter { c -> c.isDigit() }.take(6)) }, "lowStock") },
                        keyboard = KeyboardType.Number, placeholder = "Default: ${vm.defaultLowStock}", error = ed.errors["lowStock"],
                        help = "Leave empty to use your default from Settings.",
                    )
                    Field("Cost price (only you see this)", f.cost, { v -> ed.edit({ it.copy(cost = v.filter { c -> c.isDigit() || c == '.' }.take(9)) }, "cost") },
                        prefix = "£", keyboard = KeyboardType.Decimal, error = ed.errors["cost"],
                        help = marginText(f.price, f.cost))
                    Field("Product code / SKU (optional)", f.sku, { v -> ed.edit({ it.copy(sku = v.take(60)) }, "sku") }, error = ed.errors["sku"])
                    Field("Barcode (optional)", f.barcode, { v -> ed.edit({ it.copy(barcode = v.filter { c -> c.isLetterOrDigit() }.take(60)) }, "barcode") }, keyboard = KeyboardType.Number, error = ed.errors["barcode"])
                }
            }

            PrimaryButton(
                if (id == null) "Add product" else "Save changes",
                onClick = { save() },
                busy = ed.saving,
                enabled = ed.dirty || id == null,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 20.dp).fillMaxWidth(),
            )

            if (existing != null) {
                Text(
                    "Added ${Fmt.full(existing.createdAt)} · Last changed ${Fmt.ago(existing.updatedAt)}",
                    style = T.caption, modifier = Modifier.padding(horizontal = 20.dp),
                )
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryButton(
                        if (existing.archived) "Put back on sale" else "Remove from sale",
                        tone = if (existing.archived) Tone.GREEN else Tone.ORANGE,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            val archive = !existing.archived
                            scope.launch { vm.act(if (archive) "Removed from sale" else "Back on sale") { it.setArchived(existing.id, archive) } }
                        },
                    )
                    SecondaryButton("Delete", tone = Tone.RED, modifier = Modifier.weight(1f), onClick = { confirmDelete = true })
                }
            }
            Spacer(Modifier.navigationBarsPadding())
        }
    }

    if (confirmLeave) {
        ConfirmDialog(
            "Discard changes?", "Your changes to this product haven't been saved.",
            confirm = "Discard", destructive = true, dismiss = "Keep editing",
            onConfirm = { confirmLeave = false; ed.form = ed.initial; ed.image = null; ed.removeImage = false; nav.popBackStack() },
            onDismiss = { confirmLeave = false },
        )
    }
    if (confirmDelete && existing != null) {
        ConfirmDialog(
            "Delete ${existing.name}?",
            "It disappears from your website. If customers have ordered it before, it's removed from sale instead, so your order history stays complete.",
            confirm = "Delete", destructive = true,
            onConfirm = {
                confirmDelete = false
                scope.launch {
                    val r = vm.act(null) { it.deleteProduct(existing.id) }
                    when (r) {
                        DeleteOutcome.DELETED -> { vm.say("Product deleted"); ed.initial = ed.form; nav.popBackStack() }
                        DeleteOutcome.ARCHIVED_INSTEAD -> vm.say("It's in past orders, so it was removed from sale instead of deleted.")
                        null -> Unit
                    }
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

private fun marginText(price: String, cost: String): String? {
    val p = Validation.parsePrice(price) ?: return null
    val c = Validation.parsePrice(cost) ?: return "Used to work out your profit per item."
    val m = Analytics.marginPercent(p, c) ?: return null
    return "Profit per item: ${Money.gbp(p - c)} (${String.format(java.util.Locale.UK, "%.0f", m)}% margin)"
}

@Composable
fun CategoryPicker(cats: List<Category>, selected: String?, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = cats.firstOrNull { it.id == selected }?.name ?: "No category"
    Box(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Line2, RoundedCornerShape(14.dp))
                .clickable(role = Role.DropdownList) { open = true }.heightIn(min = 56.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Category", style = T.caption)
                Text(label, style = T.body)
            }
            Icon(Icons.Filled.KeyboardArrowDown, null, tint = C.Muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("No category") }, onClick = { onPick(null); open = false })
            cats.forEach { c -> DropdownMenuItem(text = { Text(c.name + if (!c.visible) " (hidden)" else "") }, onClick = { onPick(c.id); open = false }) }
        }
    }
    if (cats.isEmpty()) {
        Text("Tip: create categories in More → Categories to group products on your website.", style = T.caption, modifier = Modifier.padding(horizontal = 20.dp))
    }
}
