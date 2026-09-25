const firstLetter = (string: string) => {
    for (const char of string) {
        if (/\p{L}/u.test(char)) {
            return char
        }
    }

    return ''
}

export default firstLetter
