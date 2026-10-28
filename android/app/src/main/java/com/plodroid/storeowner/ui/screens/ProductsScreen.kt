package com.plodroid.storeowner.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.domain.Money
import com.plodroid.storeowner.domain.Product
import com.plodroid.storeowner.domain.StockLevel
import com.plodroid.storeowner.domain.Validation
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.Routes
import com.plodroid.storeowner.ui.components.Chip
import com.plodroid.storeowner.ui.components.ChipRow
import com.plodroid.storeowner.ui.components.EmptyState
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Group
import com.plodroid.storeowner.ui.components.Hairline
import com.plodroid.storeowner.ui.components.HeaderAction
import com.plodroid.storeowner.ui.components.Hint
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.Page
import com.plodroid.storeowner.ui.components.Pill
import com.plodroid.storeowner.ui.components.PrimaryButton
import com.plodroid.storeowner.ui.components.RowItem
import com.plodroid.storeowner.ui.components.SecondaryButton
import com.plodroid.storeowner.ui.components.SwitchRow
import com.plodroid.storeowner.ui.components.Thumb
import com.plodroid.storeowner.ui.plural
import com.plodroid.storeowner.ui.stockText
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.launch

enum class ProductFilter(val label: String) {
    ALL("All"), ON_SALE("On sale"), LOW("Running low"), OUT("Sold out"), HIDDEN("Hidden"), REMOVED("Removed")
}

private const val NO_CATEGORY = "__none"

@Composable
fun ProductsScreen(vm: OwnerViewModel, nav: NavHostController) {
    val products by vm.products.collectAsStateWithLifecycle()
    val categories by vm.categories.collectAsStateWithLifecycle()
    val owner by vm.ownerSettings.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(ProductFilter.ALL) }
    var cat by rememberSaveable { mutableStateOf<String?>(null) }
    var quickId by rememberSaveable { mutableStateOf<String?>(null) }

    val low = owner.getOrNull()?.defaultLowStock ?: 5
    val cats = categories.getOrNull().orEmpty().sortedBy { it.sortOrder }
    val catName = cats.associate { it.id to it.name }
    val all = products.getOrNull()
    val shown = remember(all, query, filter, cat, low) {
        all.orEmpty().filter { p ->
            val f = when (filter) {
                ProductFilter.ALL -> !p.archived
                ProductFilter.ON_SALE -> p.onSale
                ProductFilter.LOW -> !p.archived && p.stockLevel(low) == StockLevel.LOW
                ProductFilter.OUT -> !p.archived && p.stockLevel(low) == StockLevel.OUT
                ProductFilter.HIDDEN -> !p.archived && !p.visible
                ProductFilter.REMOVED -> p.archived
            }
            val c = when (cat) { null -> true; NO_CATEGORY -> p.categoryId == null; else -> p.categoryId == cat }
            val q = query.trim()
            f && c && (q.isEmpty() || p.name.contains(q, true) || p.description.contains(q, true))
        }.sortedWith(compareBy<Product>({ it.archived }, { it.name.lowercase() }))
    }
    fun count(f: ProductFilter) = all.orEmpty().count { p ->
        when (f) {
            ProductFilter.LOW -> !p.archived && p.stockLevel(low) == StockLevel.LOW
            ProductFilter.OUT -> !p.archived && p.stockLevel(low) == StockLevel.OUT
            else -> false
        }
    }

    Page(
        title = "Products",
        subtitle = all?.let { list -> plural(list.count { !it.archived }, "product") },
        action = { HeaderAction("Add", Icons.Filled.Add) { nav.navigate(Routes.product(null)) } },
    ) {
        item("hint") {
            Hint(
                visible = "products" !in hints,
                text = "Tap Add to put a new product on your website. Tap any product to quickly change its stock, or hide it from the website.",
                onDismiss = { vm.dismissHint("products") },
            )
        }
        when (val l = products) {
            is Loadable.Loading -> { item("load") { LoadingBlock() }; return@Page }
            is Loadable.Failed -> { item("err") { ErrorBlock(l.message) }; return@Page }
            is Loadable.Ready -> Unit
        }
        if (all.isNullOrEmpty()) {
            item("empty") {
                EmptyState(
                    "No products yet",
                    "Add your first product and it will appear on your website straight away.",
                ) { PrimaryButton("Add a product", onClick = { nav.navigate(Routes.product(null)) }) }
            }
            return@Page
        }
        item("search") { SearchBox(query, { query = it }, "Search products") }
        item("filters") {
            ChipRow {
                ProductFilter.entries.forEach { f ->
                    Chip(f.label, filter == f, { filter = f }, count = if (f == ProductFilter.LOW || f == ProductFilter.OUT) count(f) else null)
                }
            }
        }
        if (cats.isNotEmpty()) {
            item("cats") {
                ChipRow {
                    Chip("Every category", cat == null, { cat = null })
                    cats.forEach { c -> Chip(c.name, cat == c.id, { cat = c.id }) }
                    Chip("No category", cat == NO_CATEGORY, { cat = NO_CATEGORY })
                }
            }
        }
        item("spacer") { Spacer(Modifier.height(6.dp)) }
        if (shown.isEmpty()) {
            item("none") { EmptyState("Nothing matches", "Try a different search or filter.") }
        } else {
            item("list") {
                Group {
                    shown.forEachIndexed { i, p ->
                        if (i > 0) Hairline(76.dp)
                        ProductRow(p, p.categoryId?.let { catName[it] }, low) { quickId = p.id }
                    }
                }
            }
        }
    }

    val quick = quickId?.let { id -> all?.firstOrNull { it.id == id } }
    LaunchedEffect(quick, all) { if (quickId != null && quick == null && all != null) quickId = null }   // deleted elsewhere
    if (quick != null) {
        QuickProductDialog(vm, quick, quick.categoryId?.let { catName[it] }, low,
            onEdit = { quickId = null; nav.navigate(Routes.product(quick.id)) },
            onDismiss = { quickId = null })
    }
}

@Composable
fun SearchBox(value: String, onChange: (String) -> Unit, placeholder: String) {
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth()
            .clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Line, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = C.Faint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, style = T.body.copy(color = C.Faint))
            BasicTextField(
                value = value, onValueChange = onChange, singleLine = true,
                textStyle = T.body, cursorBrush = SolidColor(C.Orange),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
            )
        }
        if (value.isNotEmpty()) TextButton(onClick = { onChange("") }) { Text("Clear", color = C.Muted) }
    }
}

@Composable
private fun ProductRow(p: Product, category: String?, low: Int, onClick: () -> Unit) {
    val (stock, tone) = stockText(p, low)
    RowItem(
        onClick = onClick,
        leading = { Thumb(p.image, p.name, 48.dp) },
        trailing = { Pill(if (p.archived) "Removed" else stock, if (p.archived) Tone.NEUTRAL else tone) },
        chevron = false,
    ) {
        Text(p.name, style = T.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(listOfNotNull(category, Money.gbp(p.price)).joinToString(" · "), style = T.caption.copy(fontSize = 13.sp), maxLines = 1)
            if (!p.visible && !p.archived) { Spacer(Modifier.width(6.dp)); Pill("Hidden", Tone.NEUTRAL) }
        }
    }
}

/** Fast stock / visibility changes without opening the full editor. */
@Composable
private fun QuickProductDialog(
    vm: OwnerViewModel,
    p: Product,
    category: String?,
    low: Int,
    onEdit: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var stockInput by remember(p.id) { mutableStateOf(p.stock.toString()) }
    var saving by remember { mutableStateOf(false) }
    var toggling by remember { mutableStateOf(false) }
    LaunchedEffect(p.stock) { if (!saving) stockInput = p.stock.toString() }
    val parsed = Validation.parseWhole(stockInput, Validation.MAX_STOCK)

    Dialog(onDismissRequest = { if (!saving) onDismiss() }) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(C.Surface2)
                .border(1.dp, C.Line2, RoundedCornerShape(24.dp)).verticalScroll(rememberScrollState()).padding(vertical = 18.dp),
        ) {
            Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Thumb(p.image, p.name, 56.dp, 14.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.name, style = T.title.copy(fontSize = 18.sp), maxLines = 2)
                    Text(listOfNotNull(category, Money.gbp(p.price)).joinToString(" · "), style = T.bodyMuted)
                }
            }
            Spacer(Modifier.height(18.dp))
            Text("STOCK", style = T.section, modifier = Modifier.padding(horizontal = 18.dp))
            Row(Modifier.padding(horizontal = 18.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                StepButton("−", "Remove one", enabled = (parsed ?: 0) > 0) { stockInput = ((parsed ?: 0) - 1).coerceAtLeast(0).toString() }
                Box(
                    Modifier.weight(1f).padding(horizontal = 10.dp).clip(RoundedCornerShape(14.dp)).background(C.Surface)
                        .border(1.dp, if (parsed == null) C.Red else C.Line2, RoundedCornerShape(14.dp)).padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    BasicTextField(
                        value = stockInput,
                        onValueChange = { v -> stockInput = v.filter { it.isDigit() }.take(7) },
                        singleLine = true,
                        textStyle = T.number.copy(textAlign = TextAlign.Center),
                        cursorBrush = SolidColor(C.Orange),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Stock quantity" },
                    )
                }
                StepButton("+", "Add one", enabled = parsed != null) { stockInput = ((parsed ?: 0) + 1).toString() }
            }
            val (label, _) = stockText(p.copy(stock = parsed ?: p.stock), low)
            Text(
                if (parsed == null) "Enter a whole number of 0 or more." else "Customers will see: $label",
                style = T.caption.copy(color = if (parsed == null) C.Red else C.Faint),
                modifier = Modifier.padding(horizontal = 18.dp),
            )
            PrimaryButton(
                "Save stock",
                enabled = parsed != null && parsed != p.stock,
                busy = saving,
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp).fillMaxWidth(),
                onClick = {
                    val v = parsed ?: return@PrimaryButton
                    saving = true
                    scope.launch {
                        vm.act(if (v == 0) "Stock saved — it now shows as sold out" else "Stock saved — your website shows $v") { it.setStock(p.id, v) }
                        saving = false
                    }
                },
            )
            Hairline(0.dp)
            if (!p.archived) {
                SwitchRow(
                    "Show on website",
                    if (p.visible) "Customers can see and buy it" else "Hidden — customers can't see it",
                    checked = p.visible,
                    enabled = !toggling,
                    onChange = { on ->
                        toggling = true
                        scope.launch {
                            vm.act(if (on) "Now showing on your website" else "Hidden from your website") { it.setVisible(p.id, on) }
                            toggling = false
                        }
                    },
                )
                Hairline(0.dp)
            }
            Row(Modifier.padding(horizontal = 18.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Edit details", onClick = onEdit, modifier = Modifier.weight(1f))
                SecondaryButton(
                    if (p.archived) "Put back on sale" else "Remove from sale",
                    tone = if (p.archived) Tone.GREEN else Tone.RED,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        val archive = !p.archived
                        scope.launch {
                            vm.act(if (archive) "Removed from sale. You can put it back any time." else "Back on sale") { it.setArchived(p.id, archive) }
                        }
                    },
                )
            }
            TextButton(onClick = onDismiss, enabled = !saving, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Close", color = C.Muted)
            }
        }
    }
}

@Composable
fun StepButton(symbol: String, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(52.dp).clip(CircleShape).background(if (enabled) C.Surface3 else C.Surface)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text(symbol, style = T.title.copy(fontSize = 24.sp, color = if (enabled) C.Text else C.Faint, fontWeight = FontWeight.Medium)) }
}

