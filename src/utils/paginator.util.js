import InternalServerError from '#errors/internalServer.error.js'
import UnprocessableEntityError from '#errors/unprocessableEntity.error.js'

const PAGINATION_LIMITS = Object.freeze({
    PAGE : 1,
    PAGE_SIZE : 10,
    MAX_PAGE: 1000,
    MAX_PAGE_SIZE : 500,
})

const toIntStrict = (value, { min, max, field, fallback  }) => {
    if (value === undefined || value === null || value === '') return fallback 
    const n = Number(value)
    if(!Number.isSafeInteger(n) || n < min || n > max){
        throw new UnprocessableEntityError(`${field} must be an integer between ${min} and ${max}`)
    }
    return n
}

const normalizeTotal = (total) => {
    const n =
        typeof total === 'bigint' ? Number(total)
        : typeof total === 'string' && /^\d+$/.test(total) ? Number(total)
        : total
    if (!Number.isSafeInteger(n) || n < 0) {
        throw new InternalServerError('Paginator: total must be an integer >= 0')
    }
    return n
}


const parse = ({page, pageSize}={})=>{
    const safePage = toIntStrict(page, {field: "page", min: 1, max: PAGINATION_LIMITS.MAX_PAGE, fallback : PAGINATION_LIMITS.PAGE})
    const safePageSize = toIntStrict(pageSize, {field: "pageSize", min: 1, max: PAGINATION_LIMITS.MAX_PAGE_SIZE, fallback : PAGINATION_LIMITS.PAGE_SIZE})
    const offset = (safePage - 1) * safePageSize
    if (!Number.isSafeInteger(offset)) throw new UnprocessableEntityError('Invalid pagination offset')
    return {
        page: safePage,
        pageSize: safePageSize,
        offset
    }
}

const of = (items, total) => {
    if (!Array.isArray(items)) throw new InternalServerError('Paginator.of: expected (items[])')
    return { items, total: normalizeTotal(total) }
}

const buildPagination = ({ total, pageSize, page} = {})=>{
    const { page: safePage, pageSize: safePageSize } = parse({page, pageSize})
    const safeTotal = normalizeTotal(total)
    const totalPages = Math.ceil(safeTotal / safePageSize)

    return {
        page: safePage,
        pageSize: safePageSize,
        total: safeTotal,
        totalPages,
        hasPrev: safePage > 1,
        hasMore: safePage < totalPages
    }
}

const paginate = async (query, fetchPage) => {
    if (typeof fetchPage !== 'function') throw new InternalServerError('Paginator.paginate: fetchPage must be a function')
    const { page, pageSize, offset } = parse(query)
    const raw = await fetchPage({ pageSize, offset })
    const { items, total } = of(raw?.items, raw?.total)
    return { items, paging: { total, page, pageSize } }
}

export const Paginator = {
    PAGINATION_LIMITS,
    buildPagination,
    paginate,
    parse,
    of
}