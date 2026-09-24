import { QueryService as AppQueryService } from '@penumbra-zone/protobuf/penumbra/core/app/v1/app_connect'
import { QueryService as GovernanceQueryService } from '@penumbra-zone/protobuf/penumbra/core/component/governance/v1/governance_connect'
import { createClient } from '@/shared/utils/protos/utils'

const UM_BASE_UNITS = 1_000_000

const grpcEndpoint = () =>
    process.env['PENUMBRA_GRPC_ENDPOINT_INTERNAL'] ??
    process.env['PENUMBRA_GRPC_ENDPOINT'] ??
    'https://penumbra.rotko.net'

/** pd renders the quorum `Ratio` as "40/100"; accept a plain decimal too. */
export const parseRatio = (raw: string): number | undefined => {
    const [num, den, extra] = raw.trim().split('/')
    if (extra !== undefined || !num) {
        return
    }
    const n = Number(num)
    const d = den === undefined ? 1 : Number(den)
    if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
        return
    }
    return n / d
}

/**
 * The quorum the chain will actually apply, in UM.
 *
 * pd snapshots the voting power of every validator that is ACTIVE when a
 * proposal is submitted, and quorum is `proposal_valid_quorum` of that sum
 * (governance `tally.rs` meets_quorum). The explorer backend instead sums
 * `voting_power` over its whole validators table — inactive, jailed and
 * disabled rows included — which put proposals 13/14 at 7.56M UM needed
 * when the chain needs 1.24M. So take the denominator from pd itself.
 *
 * Returns undefined on any failure so the caller can fall back.
 */
export const getChainQuorum = async (
    proposalId: number
): Promise<number | undefined> => {
    try {
        const endpoint = grpcEndpoint()
        const gov = createClient(endpoint, GovernanceQueryService)
        const app = createClient(endpoint, AppQueryService)
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), 4_000)
        })
        const [power, params] = await Promise.race([
            Promise.all([
                gov.votingPowerAtProposalStart({
                    proposalId: BigInt(proposalId),
                }),
                app.appParameters({}),
            ]),
            timeout,
        ])
        const ratio = parseRatio(
            params.appParameters?.governanceParams?.proposalValidQuorum ?? ''
        )
        if (ratio === undefined || power.votingPower <= 0n) {
            return
        }
        return (Number(power.votingPower) * ratio) / UM_BASE_UNITS
    } catch {
        return
    }
}
