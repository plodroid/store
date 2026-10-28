package com.plodroid.storeowner.domain

/** What the product form holds while the owner is typing (everything is text until saved). */
data class ProductForm(
    val name: String = "",
    val price: String = "",
    val stock: String = "",
    val categoryId: String? = null,
    val description: String = "",
    val visible: Boolean = true,
    val featured: Boolean = false,
    val unit: String = "",
    val lowStock: String = "",
    val sku: String = "",
    val barcode: String = "",
    val cost: String = "",
) {
    companion object {
        fun from(p: Product, priv: ProductPrivate?): ProductForm = ProductForm(
            name = p.name,
            price = Validation.priceText(p.price),
            stock = p.stock.toString(),
            categoryId = p.categoryId,
            description = p.description,
            visible = p.visible,
            featured = p.featured,
            unit = p.unit.orEmpty(),
            lowStock = p.lowStockThreshold?.toString().orEmpty(),
            sku = priv?.sku.orEmpty(),
            barcode = priv?.barcode.orEmpty(),
            cost = priv?.costPrice?.let { Validation.priceText(it) }.orEmpty(),
        )
    }
}

/** A checked, ready-to-save product. */
data class ValidProduct(
    val name: String,
    val price: Double,
    val stock: Int,
    val categoryId: String?,
    val description: String,
    val visible: Boolean,
    val featured: Boolean,
    val unit: String?,
    val lowStockThreshold: Int?,
    val private: ProductPrivate,
)

sealed class Checked<out T> {
    data class Ok<T>(val value: T) : Checked<T>()
    data class Problems(val byField: Map<String, String>) : Checked<Nothing>()
}

object Validation {
    const val MAX_PRICE = 100_000.0
    const val MAX_STOCK = 1_000_000

    private val priceRe = Regex("""^\d{1,6}(\.\d{1,2})?$""")

    /** "£1,234.5" → 1234.5. Returns null for anything that isn't a sensible money amount. */
    fun parsePrice(raw: String): Double? {
        val s = raw.trim().removePrefix("£").replace(",", "").replace(" ", "")
        if (!priceRe.matches(s)) return null
        val v = s.toDoubleOrNull() ?: return null
        return if (v in 0.0..MAX_PRICE) v else null
    }

    fun priceText(v: Double): String = Money.gbp(v).removePrefix("£").replace(",", "")

    fun parseWhole(raw: String, max: Int): Int? {
        val s = raw.trim()
        if (s.isEmpty() || s.length > 7 || !s.all { it.isDigit() }) return null
        val v = s.toIntOrNull() ?: return null
        return if (v in 0..max) v else null
    }

    fun product(f: ProductForm): Checked<ValidProduct> {
        val e = linkedMapOf<String, String>()
        val name = f.name.trim()
        if (name.isEmpty()) e["name"] = "Customers need a name to find the product."
        else if (name.length > 120) e["name"] = "Keep the name under 120 characters."

        val price = parsePrice(f.price)
        if (f.price.isBlank()) e["price"] = "Add a price so customers know what it costs."
        else if (price == null) e["price"] = "Use a number like 2.50 (up to £100,000)."

        val stock = parseWhole(f.stock, MAX_STOCK)
        if (f.stock.isBlank()) e["stock"] = "Add how many you have, so the website can stop sales at zero."
        else if (stock == null) e["stock"] = "Use a whole number of 0 or more."

        if (f.description.length > 2000) e["description"] = "Keep the description under 2000 characters."
        if (f.unit.length > 30) e["unit"] = "Keep this short, like \"bottle\" or \"kg\"."

        val low = if (f.lowStock.isBlank()) null else parseWhole(f.lowStock, 100_000)
        if (f.lowStock.isNotBlank() && low == null) e["lowStock"] = "Use a whole number, or leave it empty for the default."

        val cost = if (f.cost.isBlank()) null else parsePrice(f.cost)
        if (f.cost.isNotBlank() && cost == null) e["cost"] = "Use a number like 1.20, or leave it empty."
        if (f.sku.length > 60) e["sku"] = "Keep the code under 60 characters."
        if (f.barcode.length > 60) e["barcode"] = "Keep the barcode under 60 characters."

        if (e.isNotEmpty()) return Checked.Problems(e)
        return Checked.Ok(
            ValidProduct(
                name = name,
                price = price!!,
                stock = stock!!,
                categoryId = f.categoryId,
                description = f.description.trim(),
                visible = f.visible,
                featured = f.featured,
                unit = f.unit.trim().ifEmpty { null },
                lowStockThreshold = low,
                private = ProductPrivate(costPrice = cost, sku = f.sku.trim(), barcode = f.barcode.trim()),
            )
        )
    }

    fun categoryName(raw: String): String? {
        val n = raw.trim()
        return if (n.isEmpty()) "Give the category a name customers will understand."
        else if (n.length > 60) "Keep the name under 60 characters."
        else null
    }

    fun deliveryFee(raw: String): Double? = if (raw.isBlank()) 0.0 else parsePrice(raw)?.takeIf { it <= 1000.0 }
}
