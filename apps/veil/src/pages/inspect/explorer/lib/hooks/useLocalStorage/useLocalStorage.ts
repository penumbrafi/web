import { useCallback, useEffect, useState } from 'react'

type Value<T> = null | T

/** A stored value that is missing, unreadable or not JSON reads as null. */
const parseStored = <T>(raw: null | string): Value<T> => {
    if (raw === null) {return null}
    try {
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

const useLocalStorage = <T>(key: string): [Value<T>, (value: T) => void] => {
    const [value, setValue] = useState<Value<T>>(null)

    useEffect(() => {
        let storageValue: null | string = null
        try {
            storageValue = window.localStorage.getItem(key)
        } catch {
            // storage blocked (private mode, sandboxed iframe): behave as empty
        }
        setValue(parseStored<T>(storageValue))
    }, [key])

    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === null) {
                setValue(null)
            } else if (e.key === key) {
                setValue(parseStored<T>(e.newValue))
            }
        }

        window.addEventListener('storage', onStorage)

        return () => window.removeEventListener('storage', onStorage)
    }, [key])

    const setStorageValue = useCallback(
        (value: Value<T>) => {
            setValue(value)

            try {
                if (value === null) {
                    window.localStorage.removeItem(key)
                } else {
                    window.localStorage.setItem(key, JSON.stringify(value))
                }
            } catch {
                // quota or blocked storage: keep the in-memory value
            }
        },
        [key]
    )

    return [value, setStorageValue]
}

export default useLocalStorage
