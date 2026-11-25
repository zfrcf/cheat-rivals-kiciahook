package com.phonepilot.handlers

import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import android.telecom.TelecomManager
import android.telephony.SmsManager
import com.phonepilot.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone

/** SMS, appels, contacts, agenda : accès direct aux fournisseurs de contenu (plus fiable que l'UI). */
object Comms {
    private val ctx get() = PhonePilotApp.instance
    private val cr get() = ctx.contentResolver

    /** « Maman » → numéro ; un numéro reste un numéro. */
    private fun resolveNumber(to: String): String {
        if (Regex("^[+\\d][\\d\\s.-]{5,}$").matches(to)) return to.replace(Regex("[\\s.-]"), "")
        val c = contacts(to, 1)
        return c.optJSONObject(0)?.optJSONArray("phones")?.optString(0)?.takeIf { it.isNotBlank() }
            ?: throw RpcError("CONTACT_NOT_FOUND", "Aucun numéro pour « $to ».")
    }

    fun contacts(query: String, limit: Int): JSONArray {
        val out = JSONArray()
        val uri = Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(query))
        cr.query(uri, arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME), null, null, null)?.use { c ->
            while (c.moveToNext() && out.length() < limit) {
                val id = c.getString(0)
                out.put(json("id" to id, "name" to c.getString(1), "phones" to dataFor(id, ContactsContract.CommonDataKinds.Phone.CONTENT_URI, ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.CONTACT_ID),
                    "emails" to dataFor(id, ContactsContract.CommonDataKinds.Email.CONTENT_URI, ContactsContract.CommonDataKinds.Email.ADDRESS, ContactsContract.CommonDataKinds.Email.CONTACT_ID)))
            }
        }
        return out
    }

    private fun dataFor(id: String, uri: Uri, col: String, idCol: String): JSONArray {
        val a = JSONArray()
        cr.query(uri, arrayOf(col), "$idCol = ?", arrayOf(id), null)?.use { while (it.moveToNext()) a.put(it.getString(0)) }
        return a
    }

    private fun addData(ops: ArrayList<ContentProviderOperation>, rawRef: Int?, rawId: Long?, mime: String, vararg kv: Pair<String, Any?>) {
        val b = ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
        if (rawRef != null) b.withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawRef) else b.withValue(ContactsContract.Data.RAW_CONTACT_ID, rawId)
        b.withValue(ContactsContract.Data.MIMETYPE, mime)
        kv.forEach { (k, v) -> b.withValue(k, v) }
        ops.add(b.build())
    }

    val handlers: Map<String, Handler> = mapOf(
        "sms.list" to { p ->
            val uri = when (p.optString("box", "inbox")) { "sent" -> Telephony.Sms.Sent.CONTENT_URI; "all" -> Telephony.Sms.CONTENT_URI; else -> Telephony.Sms.Inbox.CONTENT_URI }
            val sel = mutableListOf<String>(); val args = mutableListOf<String>()
            isoToMs(p.str("after"))?.let { sel += "${Telephony.Sms.DATE} >= ?"; args += it.toString() }
            p.str("contains")?.let { sel += "${Telephony.Sms.BODY} LIKE ?"; args += "%$it%" }
            p.str("from")?.let { f ->
                val num = runCatching { resolveNumber(f) }.getOrDefault(f)
                sel += "${Telephony.Sms.ADDRESS} LIKE ?"; args += "%${num.takeLast(9)}%"
            }
            val out = JSONArray()
            cr.query(uri, arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.READ),
                sel.joinToString(" AND ").ifEmpty { null }, args.toTypedArray(), "${Telephony.Sms.DATE} DESC")?.use { c ->
                while (c.moveToNext() && out.length() < p.int("limit", 20)) {
                    val addr = c.getString(0) ?: ""
                    out.put(json("address" to addr, "name" to PhoneEventsReceiver.contactName(ctx, addr), "body" to c.getString(1), "date" to msToIso(c.getLong(2)),
                        "sent" to (c.getInt(3) == Telephony.Sms.MESSAGE_TYPE_SENT), "read" to (c.getInt(4) == 1)))
                }
            }
            out
        },
        "sms.send" to { p ->
            val num = resolveNumber(p.getString("to"))
            val sms = ctx.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
            sms.sendMultipartTextMessage(num, null, sms.divideMessage(p.getString("text")), null, null)
            json("ok" to true, "to" to num)
        },
        "call.start" to { p ->
            val num = resolveNumber(p.getString("to"))
            ctx.startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(num))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            json("ok" to true, "to" to num)
        },
        "call.end" to { _ ->
            @Suppress("DEPRECATION")
            json("ok" to ctx.getSystemService(TelecomManager::class.java).endCall())
        },
        "call.log" to { p ->
            val sel = mutableListOf<String>(); val args = mutableListOf<String>()
            when (p.optString("type", "all")) {
                "missed" -> { sel += "${CallLog.Calls.TYPE} IN (?,?)"; args += listOf("${CallLog.Calls.MISSED_TYPE}", "${CallLog.Calls.REJECTED_TYPE}") }
                "incoming" -> { sel += "${CallLog.Calls.TYPE} = ?"; args += "${CallLog.Calls.INCOMING_TYPE}" }
                "outgoing" -> { sel += "${CallLog.Calls.TYPE} = ?"; args += "${CallLog.Calls.OUTGOING_TYPE}" }
            }
            isoToMs(p.str("after"))?.let { sel += "${CallLog.Calls.DATE} >= ?"; args += it.toString() }
            val types = mapOf(CallLog.Calls.INCOMING_TYPE to "entrant", CallLog.Calls.OUTGOING_TYPE to "sortant", CallLog.Calls.MISSED_TYPE to "manqué", CallLog.Calls.REJECTED_TYPE to "rejeté")
            val out = JSONArray()
            cr.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
                sel.joinToString(" AND ").ifEmpty { null }, args.toTypedArray(), "${CallLog.Calls.DATE} DESC")?.use { c ->
                while (c.moveToNext() && out.length() < p.int("limit", 30))
                    out.put(json("number" to c.getString(0), "name" to c.getString(1), "type" to (types[c.getInt(2)] ?: c.getInt(2).toString()), "date" to msToIso(c.getLong(3)), "durationSec" to c.getLong(4)))
            }
            out
        },
        "contacts.search" to { p -> contacts(p.getString("query"), p.int("limit", 20)) },
        "contacts.create" to { p ->
            val ops = arrayListOf(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null).withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null).build())
            addData(ops, 0, null, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME to p.getString("name"))
            p.strList("phones").forEach { addData(ops, 0, null, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Phone.NUMBER to it, ContactsContract.CommonDataKinds.Phone.TYPE to ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE) }
            p.strList("emails").forEach { addData(ops, 0, null, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Email.ADDRESS to it) }
            p.str("company")?.let { addData(ops, 0, null, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Organization.COMPANY to it) }
            p.str("note")?.let { addData(ops, 0, null, ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Note.NOTE to it) }
            cr.applyBatch(ContactsContract.AUTHORITY, ops)
            json("ok" to true)
        },
        "contacts.update" to { p ->
            val id = p.getString("id")
            val rawId = cr.query(ContactsContract.RawContacts.CONTENT_URI, arrayOf(ContactsContract.RawContacts._ID), "${ContactsContract.RawContacts.CONTACT_ID}=?", arrayOf(id), null)
                ?.use { if (it.moveToFirst()) it.getLong(0) else null } ?: throw RpcError("NOT_FOUND", "Contact $id introuvable")
            val ops = arrayListOf<ContentProviderOperation>()
            p.str("name")?.let { ops.add(ContentProviderOperation.newUpdate(ContactsContract.Data.CONTENT_URI)
                .withSelection("${ContactsContract.Data.RAW_CONTACT_ID}=? AND ${ContactsContract.Data.MIMETYPE}=?", arrayOf(rawId.toString(), ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE))
                .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, it).build()) }
            p.strList("add_phones").forEach { addData(ops, null, rawId, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Phone.NUMBER to it, ContactsContract.CommonDataKinds.Phone.TYPE to ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE) }
            p.strList("add_emails").forEach { addData(ops, null, rawId, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Email.ADDRESS to it) }
            p.str("company")?.let { addData(ops, null, rawId, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Organization.COMPANY to it) }
            p.str("note")?.let { addData(ops, null, rawId, ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Note.NOTE to it) }
            cr.applyBatch(ContactsContract.AUTHORITY, ops)
            json("ok" to true)
        },
        "contacts.export_vcf" to { _ ->
            val keys = mutableListOf<String>()
            cr.query(ContactsContract.Contacts.CONTENT_URI, arrayOf(ContactsContract.Contacts.LOOKUP_KEY), null, null, null)?.use { while (it.moveToNext()) keys += it.getString(0) }
            val uri = Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_MULTI_VCARD_URI, Uri.encode(keys.joinToString(":")))
            val vcf = cr.openAssetFileDescriptor(uri, "r")?.createInputStream()?.bufferedReader()?.readText() ?: ""
            json("vcf" to vcf, "count" to keys.size)
        },
        "calendar.list" to { p ->
            val from = isoToMs(p.str("from")) ?: System.currentTimeMillis()
            val to = isoToMs(p.str("to")) ?: (from + 7 * 86_400_000L)
            val b = CalendarContract.Instances.CONTENT_URI.buildUpon(); ContentUris.appendId(b, from); ContentUris.appendId(b, to)
            val out = JSONArray()
            val q = p.str("query")?.lowercase()
            cr.query(b.build(), arrayOf(CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
                CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.CALENDAR_DISPLAY_NAME), null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
                while (c.moveToNext()) {
                    if (q != null && !(c.getString(1) ?: "").lowercase().contains(q)) continue
                    out.put(json("id" to c.getLong(0).toString(), "title" to c.getString(1), "start" to msToIso(c.getLong(2)), "end" to msToIso(c.getLong(3)),
                        "location" to c.getString(4), "allDay" to (c.getInt(5) == 1), "calendar" to c.getString(6)))
                }
            }
            out
        },
        "calendar.create" to { p ->
            val start = isoToMs(p.getString("start"))!!
            val end = isoToMs(p.str("end")) ?: (start + 3_600_000)
            val calId = calendarId(p.str("calendar"))
            val v = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, calId); put(CalendarContract.Events.TITLE, p.getString("title"))
                put(CalendarContract.Events.DTSTART, start); put(CalendarContract.Events.DTEND, end)
                put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
                put(CalendarContract.Events.ALL_DAY, if (p.bool("all_day", false)) 1 else 0)
                p.str("location")?.let { put(CalendarContract.Events.EVENT_LOCATION, it) }
                p.str("description")?.let { put(CalendarContract.Events.DESCRIPTION, it) }
            }
            val id = ContentUris.parseId(cr.insert(CalendarContract.Events.CONTENT_URI, v)!!)
            if (p.has("reminder_minutes")) cr.insert(CalendarContract.Reminders.CONTENT_URI, ContentValues().apply {
                put(CalendarContract.Reminders.EVENT_ID, id); put(CalendarContract.Reminders.MINUTES, p.getInt("reminder_minutes")); put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
            })
            json("ok" to true, "id" to id.toString())
        },
        "calendar.update" to { p ->
            val v = ContentValues()
            p.str("title")?.let { v.put(CalendarContract.Events.TITLE, it) }
            isoToMs(p.str("start"))?.let { v.put(CalendarContract.Events.DTSTART, it) }
            isoToMs(p.str("end"))?.let { v.put(CalendarContract.Events.DTEND, it) }
            p.str("location")?.let { v.put(CalendarContract.Events.EVENT_LOCATION, it) }
            p.str("description")?.let { v.put(CalendarContract.Events.DESCRIPTION, it) }
            val n = cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, p.getString("id").toLong()), v, null, null)
            if (n == 0) throw RpcError("NOT_FOUND", "Événement introuvable")
            json("ok" to true)
        },
    )

    private fun calendarId(name: String?): Long {
        cr.query(CalendarContract.Calendars.CONTENT_URI, arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.IS_PRIMARY, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL),
            "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR}", null, null)?.use { c ->
            var first: Long? = null
            while (c.moveToNext()) {
                if (first == null) first = c.getLong(0)
                if (name != null && c.getString(1)?.contains(name, true) == true) return c.getLong(0)
                if (name == null && c.getInt(2) == 1) return c.getLong(0)
            }
            first?.let { return it }
        }
        throw RpcError("NO_CALENDAR", "Aucun agenda modifiable sur le téléphone.")
    }
}
