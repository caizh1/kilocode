import { parentPort, workerData } from "node:worker_threads"
import type {
  EventInput,
  FavoriteInput,
  IdentityInput,
  InstallIntentInput,
  InstallIntentLookup,
  InstallationInput,
  PublicationInput,
  PublicationLookup,
  PublicationPatchesInput,
  PublicationApplyInput,
  PublicationStart,
  SearchInput,
  SessionInput,
  SessionLookup,
  UnpublishInput,
  UndoPublicationInput,
  ExtensionArtifactInput,
  ExtensionDownloadInput,
  ExtensionFavoriteInput,
  ExtensionPublicationInput,
  ExtensionReviewInput,
  ExtensionSearchInput,
} from "./model.ts"
import type { DbRequest, DbResponse } from "./protocol.ts"
import { MarketRepo } from "./repo.ts"

const port = parentPort
if (!port) throw new Error("market-db worker requires a parent port")

const data = workerData as { dir: string }
const repo = new MarketRepo(data.dir)

port.on("message", (msg: DbRequest) => {
  const response: DbResponse = { id: msg.id, ok: true }
  try {
    response.value = execute(msg)
  } catch (err) {
    response.ok = false
    response.error = err instanceof Error ? err.message : String(err)
  }
  port.postMessage(response)
  if (msg.op === "close") port.close()
})

function execute(msg: DbRequest): unknown {
  switch (msg.op) {
    case "health":
      return repo.health()
    case "importLegacy":
      return repo.importLegacy(String(msg.payload))
    case "exportLegacy":
      return repo.exportLegacy(String(msg.payload))
    case "search":
      return repo.search((msg.payload ?? {}) as SearchInput)
    case "get":
      return repo.get(String(msg.payload))
    case "version":
      return repo.version()
    case "releases":
      return repo.releases(String(msg.payload))
    case "release": {
      const value = msg.payload as { id: string; revision?: number }
      return repo.release(value.id, value.revision)
    }
    case "categories":
      return repo.categories()
    case "author":
      return repo.author(String(msg.payload))
    case "files": {
      const value = msg.payload as { id: string; revision?: number }
      return repo.files(value.id, value.revision)
    }
    case "file": {
      const value = msg.payload as { id: string; path: string; revision?: number }
      return repo.file(value.id, value.path, value.revision)
    }
    case "identity":
      return repo.identity(msg.payload as IdentityInput)
    case "createSession":
      return repo.createSession(msg.payload as SessionInput)
    case "getSession":
      return repo.getSession(msg.payload as SessionLookup)
    case "deleteSession":
      return repo.deleteSession(String(msg.payload))
    case "favorite":
      return repo.favorite(msg.payload as FavoriteInput)
    case "favorites":
      return repo.favorites(String(msg.payload))
    case "installation":
      return repo.installation(msg.payload as InstallationInput)
    case "installations":
      return repo.installations(String(msg.payload))
    case "createIntent":
      return repo.createIntent(msg.payload as InstallIntentInput)
    case "consumeIntent":
      return repo.consumeIntent(msg.payload as InstallIntentLookup)
    case "publication":
      return repo.publication(msg.payload as PublicationInput)
    case "startPublication":
      return repo.startPublication(msg.payload as PublicationStart)
    case "getPublication":
      return repo.getPublication(msg.payload as PublicationLookup)
    case "publications":
      return repo.publications(String(msg.payload))
    case "putPublicationPatches":
      return repo.putPublicationPatches(msg.payload as PublicationPatchesInput)
    case "applyPublicationPatches":
      return repo.applyPublicationPatches(msg.payload as PublicationApplyInput)
    case "unpublish":
      return repo.unpublish(msg.payload as UnpublishInput)
    case "undoPublication":
      return repo.undoPublication(msg.payload as UndoPublicationInput)
    case "events":
      return repo.events(msg.payload as EventInput[])
    case "aggregate":
      return repo.aggregate()
    case "maintain":
      return repo.maintain(String(msg.payload))
    case "searchExtensions":
      return repo.searchExtensions((msg.payload ?? {}) as ExtensionSearchInput)
    case "getExtension":
      return repo.getExtension(String(msg.payload))
    case "extensionArtifact":
      return repo.extensionArtifact(String(msg.payload))
    case "extensionArtifactBySha":
      return repo.extensionArtifactBySha(String(msg.payload))
    case "extensionArtifacts":
      return repo.extensionArtifacts(String(msg.payload))
    case "publishExtension":
      return repo.publishExtension(msg.payload as ExtensionArtifactInput)
    case "touchExtensionSource": {
      const value = msg.payload as { key: string; stamp: string }
      return repo.touchExtensionSource(value.key, value.stamp)
    }
    case "extensionSystemSources":
      return repo.extensionSystemSources()
    case "unlistExtensionSource": {
      const value = msg.payload as { key: string; stamp: string }
      return repo.unlistExtensionSource(value.key, value.stamp)
    }
    case "removeExtensionArtifact": {
      const value = msg.payload as { id: string; userId: string; stamp: string }
      return repo.removeExtensionArtifact(value.id, value.userId, value.stamp)
    }
    case "extensionPublication":
      return repo.extensionPublication(msg.payload as ExtensionPublicationInput)
    case "getExtensionPublication": {
      const value = msg.payload as { id: string; ownerId: string }
      return repo.getExtensionPublication(value.id, value.ownerId)
    }
    case "extensionPublications":
      return repo.extensionPublications(String(msg.payload))
    case "extensionFavorite":
      return repo.extensionFavorite(msg.payload as ExtensionFavoriteInput)
    case "extensionFavorites":
      return repo.extensionFavorites(String(msg.payload))
    case "extensionReviews":
      return repo.extensionReviews(String(msg.payload))
    case "extensionReview":
      return repo.extensionReview(msg.payload as ExtensionReviewInput)
    case "deleteExtensionReview": {
      const value = msg.payload as { userId: string; extensionId: string }
      return repo.deleteExtensionReview(value.userId, value.extensionId)
    }
    case "userExtensionReviews":
      return repo.userExtensionReviews(String(msg.payload))
    case "extensionUploads":
      return repo.extensionUploads(String(msg.payload))
    case "extensionDownload":
      return repo.extensionDownload(msg.payload as ExtensionDownloadInput)
    case "extensionAnalytics":
      return repo.extensionAnalytics()
    case "extensionSources": {
      const value = msg.payload as { artifactId: string; userId: string }
      return repo.extensionSources(value.artifactId, value.userId)
    }
    case "close":
      repo.close()
      return true
  }
}
