package ai.chipmate.client

import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager

object ChipMateNotifications {
    private const val GROUP = "ChipMate"

    fun error(title: String, content: String? = null) {
        val project = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }
        error(project, title, content)
    }

    fun error(project: Project?, title: String, content: String? = null) {
        val notification = NotificationGroupManager.getInstance()
            .getNotificationGroup(GROUP)
            ?.createNotification(title, content ?: "", NotificationType.ERROR)
            ?: Notification(GROUP, title, content ?: "", NotificationType.ERROR)
        notification.notify(project)
    }

    fun info(title: String, content: String? = null) {
        val project = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }
        val notification = NotificationGroupManager.getInstance()
            .getNotificationGroup(GROUP)
            ?.createNotification(title, content ?: "", NotificationType.INFORMATION)
            ?: Notification(GROUP, title, content ?: "", NotificationType.INFORMATION)
        notification.notify(project)
    }
}
