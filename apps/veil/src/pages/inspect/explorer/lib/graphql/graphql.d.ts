declare module '*' {
    import { DocumentNode } from 'graphql'
    const Schema: DocumentNode
    export = Schema
}
