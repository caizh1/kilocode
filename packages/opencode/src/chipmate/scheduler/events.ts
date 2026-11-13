import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"

export const TaskChanged = BusEvent.define("scheduled_task.changed", Schema.Struct({ taskID: Schema.String }))
export const RunChanged = BusEvent.define("scheduled_run.changed", Schema.Struct({ runID: Schema.String }))
