package ai.chipmate.backend.cli

import ai.chipmate.jetbrains.api.infrastructure.Serializer
import ai.chipmate.jetbrains.api.model.Config
import ai.chipmate.jetbrains.api.model.GlobalHealth200Response
import ai.chipmate.jetbrains.api.model.ChipMateNotifications200ResponseInner
import ai.chipmate.jetbrains.api.model.ChipMateNotifications200ResponseInnerAction
import ai.chipmate.jetbrains.api.model.ChipMateProfile200Response
import ai.chipmate.jetbrains.api.model.ChipMateProfile200ResponseBalance
import ai.chipmate.jetbrains.api.model.ChipMateProfile200ResponseProfile
import ai.chipmate.jetbrains.api.model.ChipMateProfile200ResponseProfileOrganizationsInner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies that the generated API model classes serialize/deserialize
 * correctly using the same [Serializer.kotlinxSerializationJson] instance
 * that the production [DefaultApi] client uses.
 */
class ApiModelSerializationTest {

    private val json = Serializer.kotlinxSerializationJson

    @Test
    fun `GlobalHealth200Response roundtrip`() {
        val src = """{"healthy":true,"version":"2.1.0"}"""
        val obj = json.decodeFromString<GlobalHealth200Response>(src)
        assertTrue(obj.healthy)
        assertEquals("2.1.0", obj.version)

        val back = json.encodeToString(GlobalHealth200Response.serializer(), obj)
        assertTrue(back.contains(""""healthy":true"""))
        assertTrue(back.contains(""""version":"2.1.0""""))
    }

    @Test
    fun `Config deserializes minimal JSON`() {
        val obj = json.decodeFromString<Config>("""{}""")
        assertNull(obj.model)
        assertNull(obj.provider)
        assertNull(obj.mcp)
    }

    @Test
    fun `Config deserializes with known fields`() {
        val src = """{"model":"claude-4","username":"alice"}"""
        val obj = json.decodeFromString<Config>(src)
        assertEquals("claude-4", obj.model)
        assertEquals("alice", obj.username)
    }

    @Test
    fun `Config ignores unknown fields`() {
        val src = """{"model":"test","totally_new_field":"value","nested":{"a":1}}"""
        val obj = json.decodeFromString<Config>(src)
        assertEquals("test", obj.model)
    }

    @Test
    fun `ChipMateNotifications200ResponseInner with action`() {
        val src = """{
            "id": "notif-1",
            "title": "Update available",
            "message": "Version 3.0 is out",
            "action": {"actionText": "Update now", "actionURL": "https://example.com/update"}
        }"""
        val obj = json.decodeFromString<ChipMateNotifications200ResponseInner>(src)
        assertEquals("notif-1", obj.id)
        assertEquals("Update available", obj.title)
        assertEquals("Version 3.0 is out", obj.message)
        assertNotNull(obj.action)
        assertEquals("Update now", obj.action!!.actionText)
        assertEquals("https://example.com/update", obj.action!!.actionURL)
    }

    @Test
    fun `ChipMateNotifications200ResponseInner without action`() {
        val src = """{"id":"n2","title":"Info","message":"Hello"}"""
        val obj = json.decodeFromString<ChipMateNotifications200ResponseInner>(src)
        assertEquals("n2", obj.id)
        assertNull(obj.action)
        assertNull(obj.showIn)
    }

    @Test
    fun `ChipMateNotifications200ResponseInner with showIn and suggestModelId`() {
        val src = """{
            "id": "n3",
            "title": "Try new model",
            "message": "Check it out",
            "showIn": ["cli", "vscode"],
            "suggestModelId": "claude-4"
        }"""
        val obj = json.decodeFromString<ChipMateNotifications200ResponseInner>(src)
        assertEquals(listOf("cli", "vscode"), obj.showIn)
        assertEquals("claude-4", obj.suggestModelId)
    }

    @Test
    fun `empty notifications array`() {
        val list = json.decodeFromString<List<ChipMateNotifications200ResponseInner>>("[]")
        assertTrue(list.isEmpty())
    }

    @Test
    fun `ChipMateProfile200Response with balance`() {
        val src = """{
            "profile": {"email": "user@test.com", "name": "User"},
            "balance": {"balance": 42.5},
            "chipmatePass": null,
            "currentOrgId": "org-1"
        }"""
        val obj = json.decodeFromString<ChipMateProfile200Response>(src)
        assertEquals("user@test.com", obj.profile.email)
        assertEquals("User", obj.profile.name)
        assertNotNull(obj.balance)
        assertEquals(42.5, obj.balance!!.balance)
        assertEquals("org-1", obj.currentOrgId)
    }

    @Test
    fun `ChipMateProfile200Response with null balance`() {
        val src = """{
            "profile": {"email": "user@test.com"},
            "balance": null,
            "chipmatePass": null,
            "currentOrgId": null
        }"""
        val obj = json.decodeFromString<ChipMateProfile200Response>(src)
        assertEquals("user@test.com", obj.profile.email)
        assertNull(obj.balance)
        assertNull(obj.currentOrgId)
    }

    @Test
    fun `ChipMateProfile200Response with organizations`() {
        val src = """{
            "profile": {
                "email": "user@test.com",
                "organizations": [
                    {"id": "org-1", "name": "Acme", "role": "admin"},
                    {"id": "org-2", "name": "Beta", "role": "member"}
                ]
            },
            "balance": null,
            "chipmatePass": null,
            "currentOrgId": "org-1"
        }"""
        val obj = json.decodeFromString<ChipMateProfile200Response>(src)
        assertNotNull(obj.profile.organizations)
        assertEquals(2, obj.profile.organizations!!.size)
        assertEquals("Acme", obj.profile.organizations!![0].name)
        assertEquals("admin", obj.profile.organizations!![0].role)
    }

    @Test
    fun `ChipMateProfile200Response with chipmate pass`() {
        val src = """{
            "profile": {"email": "user@test.com"},
            "balance": {"balance": 267.59},
            "chipmatePass": {
                "currentPeriodBaseCreditsUsd": 199,
                "currentPeriodUsageUsd": 73.27,
                "currentPeriodBonusCreditsUsd": 99.5,
                "nextBillingAt": "2026-07-01T00:00:00.000Z"
            },
            "currentOrgId": null
        }"""
        val obj = json.decodeFromString<ChipMateProfile200Response>(src)
        assertNotNull(obj.chipmatePass)
        assertEquals(199.0, obj.chipmatePass!!.currentPeriodBaseCreditsUsd)
        assertEquals(73.27, obj.chipmatePass!!.currentPeriodUsageUsd)
        assertEquals(99.5, obj.chipmatePass!!.currentPeriodBonusCreditsUsd)
        assertEquals("2026-07-01T00:00:00.000Z", obj.chipmatePass!!.nextBillingAt)
    }

    @Test
    fun `Config roundtrip preserves model field`() {
        val original = Config(model = "gpt-4o", username = "test")
        val encoded = json.encodeToString(Config.serializer(), original)
        val decoded = json.decodeFromString<Config>(encoded)
        assertEquals("gpt-4o", decoded.model)
        assertEquals("test", decoded.username)
    }
}
