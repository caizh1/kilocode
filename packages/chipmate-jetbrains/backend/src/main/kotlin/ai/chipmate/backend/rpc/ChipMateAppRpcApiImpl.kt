@file:Suppress("UnstableApiUsage")

package ai.chipmate.backend.rpc

import ai.chipmate.backend.app.ChipMateAppState
import ai.chipmate.backend.app.ChipMateBackendAppService
import ai.chipmate.backend.telemetry.ChipMateBackendTelemetry
import ai.chipmate.backend.app.ConfigWarning
import ai.chipmate.backend.app.LoadError
import ai.chipmate.backend.app.LoadProgress
import ai.chipmate.backend.app.ProfileResult
import ai.chipmate.backend.cli.ChipMateCliPlatform
import ai.chipmate.backend.cli.ChipMateProps
import ai.chipmate.backend.cli.ChipMateRepoCli
import ai.chipmate.jetbrains.api.model.ChipMateProfile200Response
import ai.chipmate.rpc.dto.ConfigPatchDto
import ai.chipmate.rpc.ChipMateAppRpcApi
import ai.chipmate.rpc.dto.ConfigWarningDto
import ai.chipmate.rpc.dto.DeviceAuthDto
import ai.chipmate.rpc.dto.HealthDto
import ai.chipmate.rpc.dto.ChipMateAppStateDto
import ai.chipmate.rpc.dto.ChipMateAppStatusDto
import ai.chipmate.rpc.dto.LoadErrorDto
import ai.chipmate.rpc.dto.LoadProgressDto
import ai.chipmate.rpc.dto.ModelFavoriteUpdateDto
import ai.chipmate.rpc.dto.ModelSelectionUpdateDto
import ai.chipmate.rpc.dto.ModelStateDto
import ai.chipmate.rpc.dto.ModelVariantUpdateDto
import ai.chipmate.rpc.dto.ProfileBalanceDto
import ai.chipmate.rpc.dto.ProfileDto
import ai.chipmate.rpc.dto.ProfileChipMatePassDto
import ai.chipmate.rpc.dto.ProfileOrganizationDto
import ai.chipmate.rpc.dto.ProfileStatusDto
import ai.chipmate.rpc.dto.TelemetryCaptureDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Backend implementation of [ChipMateAppRpcApi].
 *
 * Delegates directly to the app-level [ChipMateBackendAppService] —
 * no project resolution needed since all operations are app-scoped.
 */
class ChipMateAppRpcApiImpl : ChipMateAppRpcApi {

    private val app: ChipMateBackendAppService get() = service()

    override suspend fun connect() = app.connect()

    override suspend fun state(): Flow<ChipMateAppStateDto> =
        app.appState.map(::dto).distinctUntilChanged()

    override suspend fun health(): HealthDto = app.health()

    override suspend fun cliVersion(): String = ChipMateProps.cliVersion()

    override suspend fun cliPlatform(): String = ChipMateCliPlatform.current()

    override suspend fun cliBundled(): Boolean = ChipMateRepoCli.available()

    override suspend fun retry() = app.retry()

    override suspend fun restart() = app.restart()

    override suspend fun reinstall() = app.reinstall()

    override suspend fun modelState(): ModelStateDto {
        app.requireReady()
        return app.models.state()
    }

    override suspend fun updateModelFavorite(update: ModelFavoriteUpdateDto): ModelStateDto {
        app.requireReady()
        return app.models.favorite(update)
    }

    override suspend fun updateModelSelection(update: ModelSelectionUpdateDto): ModelStateDto {
        app.requireReady()
        return app.models.selection(update)
    }

    override suspend fun clearModelSelection(agent: String): ModelStateDto {
        app.requireReady()
        return app.models.clear(agent)
    }

    override suspend fun updateModelVariant(update: ModelVariantUpdateDto): ModelStateDto {
        app.requireReady()
        return app.models.variant(update)
    }

    override suspend fun updateConfig(patch: ConfigPatchDto): ChipMateAppStateDto {
        app.requireReady()
        return appStateDto(app.updateConfig(patch))
    }

    override suspend fun refreshProfile(): ProfileDto? = app.refreshProfile()?.let(::profileDto)

    override suspend fun startLogin(directory: String?): DeviceAuthDto = app.startLogin(directory)

    override suspend fun completeLogin(directory: String?): ProfileDto? = app.completeLogin(directory)?.let(::profileDto)

    override suspend fun logout(): Boolean = app.logout()

    override suspend fun setOrganization(organizationId: String?): ProfileDto? =
        app.setOrganization(organizationId)?.let(::profileDto)

    override suspend fun captureTelemetry(capture: TelemetryCaptureDto) {
        service<ChipMateBackendTelemetry>().capture(app.http, app.port, capture.event, capture.properties)
    }

    private fun dto(state: ChipMateAppState): ChipMateAppStateDto =
        appStateDto(state)
}

internal fun appStateDto(state: ChipMateAppState): ChipMateAppStateDto =
    when (state) {
        ChipMateAppState.Disconnected -> ChipMateAppStateDto(ChipMateAppStatusDto.DISCONNECTED)
        is ChipMateAppState.Downloading -> ChipMateAppStateDto(
            status = ChipMateAppStatusDto.DOWNLOADING,
            downloadPercent = state.percent,
            downloadVersion = state.version,
            downloadPlatform = state.platform,
        )
        ChipMateAppState.Connecting -> ChipMateAppStateDto(ChipMateAppStatusDto.CONNECTING)
        is ChipMateAppState.Loading -> ChipMateAppStateDto(
            status = ChipMateAppStatusDto.LOADING,
            progress = progress(state.progress),
        )
        is ChipMateAppState.MigrationRequired -> ChipMateAppStateDto(
            status = ChipMateAppStatusDto.MIGRATION_REQUIRED,
            migration = MigrationRpcMapper.toDto(state.detection),
        )
        is ChipMateAppState.Ready -> ChipMateAppStateDto(
            status = ChipMateAppStatusDto.READY,
            progress = LoadProgressDto(
                config = true,
                notifications = true,
                profile = if (state.data.profile != null) ProfileStatusDto.LOADED
                    else ProfileStatusDto.NOT_LOGGED_IN,
            ),
            warnings = state.data.warnings.map(::warning),
            config = state.data.config,
            profile = state.data.profile?.let(::profileDto),
        )
        is ChipMateAppState.Error -> ChipMateAppStateDto(
            status = ChipMateAppStatusDto.ERROR,
            error = state.message,
            errors = state.errors.map(::error),
        )
    }

internal fun profileDto(p: ChipMateProfile200Response): ProfileDto = ProfileDto(
    email = p.profile.email,
    name = p.profile.name,
    organizations = p.profile.organizations.orEmpty().map { org ->
        ProfileOrganizationDto(id = org.id, name = org.name, role = org.role)
    },
    // The pinned CLI release does not expose hasPersonalAccount yet, so default to
    // showing the personal account. Flip back to p.profile.hasPersonalAccount once a
    // CLI release ships the field.
    hasPersonalAccount = true,
    balance = p.balance?.balance?.let { ProfileBalanceDto(balance = it) },
    chipmatePass = p.chipmatePass?.let {
        val base = it.currentPeriodBaseCreditsUsd ?: return@let null
        val usage = it.currentPeriodUsageUsd ?: return@let null
        val bonus = it.currentPeriodBonusCreditsUsd ?: return@let null
        ProfileChipMatePassDto(
            currentPeriodBaseCreditsUsd = base,
            currentPeriodUsageUsd = usage,
            currentPeriodBonusCreditsUsd = bonus,
            nextBillingAt = it.nextBillingAt,
        )
    },
    currentOrgId = p.currentOrgId,
)

private fun progress(p: LoadProgress) = LoadProgressDto(
    config = p.config,
    notifications = p.notifications,
    profile = when (p.profile) {
        ProfileResult.PENDING -> ProfileStatusDto.PENDING
        ProfileResult.LOADED -> ProfileStatusDto.LOADED
        ProfileResult.NOT_LOGGED_IN -> ProfileStatusDto.NOT_LOGGED_IN
    },
)

private fun error(e: LoadError) = LoadErrorDto(
    resource = e.resource,
    status = e.status,
    detail = e.detail,
)

private fun warning(w: ConfigWarning) = ConfigWarningDto(
    path = w.path,
    message = w.message,
    detail = w.detail,
)
