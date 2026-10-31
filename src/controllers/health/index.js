import { apiResponse } from "#utils/apiResponse.util.js";
import lifecycleState from '#lib/lifecycle/state.js'
import { ServiceUnavailableError } from "#errors"

const live = (req, res) => apiResponse.ok(res, {status: 'ok'})

const ready = (req, res) => {
    if(lifecycleState.isShuttingDown()){
        throw new ServiceUnavailableError("shutting_down")
    }
    return apiResponse.ok(res, {status: 'ok'})
}

export const healthController = {
    ready,
    live
}