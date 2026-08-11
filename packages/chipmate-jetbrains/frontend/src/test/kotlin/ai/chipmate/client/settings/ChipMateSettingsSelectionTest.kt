package ai.chipmate.client.settings

import ai.chipmate.client.settings.models.ModelsConfigurable
import ai.chipmate.client.settings.profile.UserProfileConfigurable
import com.intellij.ide.util.PropertiesComponent
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class ChipMateSettingsSelectionTest : BasePlatformTestCase() {

    override fun tearDown() {
        try {
            PropertiesComponent.getInstance(project).unsetValue(ChipMateSettingsSelection.SELECTED_CONFIGURABLE_KEY)
        } finally {
            super.tearDown()
        }
    }

    fun `test falls back to profile when no last settings page exists`() {
        assertEquals(UserProfileConfigurable.ID, ChipMateSettingsSelection.target(project))
    }

    fun `test falls back to profile when last page is not chipmate`() {
        select("preferences.lookFeel")

        assertEquals(UserProfileConfigurable.ID, ChipMateSettingsSelection.target(project))
    }

    fun `test keeps last chipmate root page`() {
        select(ChipMateSettingsConfigurable.ID)

        assertEquals(ChipMateSettingsConfigurable.ID, ChipMateSettingsSelection.target(project))
    }

    fun `test keeps last chipmate child page`() {
        select(ModelsConfigurable.ID)

        assertEquals(ModelsConfigurable.ID, ChipMateSettingsSelection.target(project))
    }

    private fun select(id: String) {
        PropertiesComponent.getInstance(project).setValue(ChipMateSettingsSelection.SELECTED_CONFIGURABLE_KEY, id)
    }
}
