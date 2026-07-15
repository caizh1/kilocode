export interface DbRequest {
  id: number
  op:
    | "health"
    | "importLegacy"
    | "exportLegacy"
    | "search"
    | "get"
    | "version"
    | "releases"
    | "release"
    | "categories"
    | "author"
    | "files"
    | "file"
    | "identity"
    | "createSession"
    | "getSession"
    | "deleteSession"
    | "favorite"
    | "favorites"
    | "installation"
    | "installations"
    | "createIntent"
    | "consumeIntent"
    | "publication"
    | "startPublication"
    | "getPublication"
    | "publications"
    | "putPublicationPatches"
    | "applyPublicationPatches"
    | "unpublish"
    | "events"
    | "aggregate"
    | "maintain"
    | "close"
  payload?: unknown
}

export interface DbResponse {
  id: number
  ok: boolean
  value?: unknown
  error?: string
}
