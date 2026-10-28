const mongooseConverter = (err) => {
    if (err?.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0];
        return new AppError(field ? `${field} already exists` : "Duplicate value", HTTP_STATUS.CONFLICT, APP_ERROR_CODES.DUPLICATE_KEY);
    }

    switch(err.name){
        case 'CastError':
            return new AppError(`Invalid ${e.path}`, HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.INVALID_ID)
        case 'ValidationError':
            const details = e.errors ? Object.values(e.errors).map((x) => ({ field: x.path, message: x.message })) : null
            return new AppError("Validation failed", HTTP_STATUS.BAD_REQUEST, APP_ERROR_CODES.VALIDATION_FAILED, details)
    }

    return null
}

export default mongooseConverter