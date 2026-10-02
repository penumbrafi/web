use crate::error::WasmResult;
use crate::utils;
use penumbra_keys::FullViewingKey;
use penumbra_proto::DomainType;
use penumbra_transaction::{
    plan::{ActionPlan, TransactionPlan},
    Action, AuthorizationData, Transaction, WitnessData,
};
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

use rayon::prelude::*;

/// Builds a planned [`Action`] specified by
/// the [`ActionPlan`] in a [`TransactionPlan`].
/// Arguments:
///     transaction_plan: `TransactionPlan`
///     action_plan: `ActionPlan`
///     full_viewing_key: `FullViewingKey`
///     witness_data: `WitnessData``
/// Returns: `Action`
#[wasm_bindgen]
pub fn build_action(
    transaction_plan: &[u8],
    action_plan: &[u8],
    full_viewing_key: &[u8],
    witness_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();
    let transaction_plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let action_plan = ActionPlan::decode(action_plan)?;
    let full_viewing_key = FullViewingKey::decode(full_viewing_key)?;

    let action = build_action_inner(transaction_plan, action_plan, full_viewing_key, witness)?;

    Ok(action.encode_to_vec())
}

pub fn build_action_inner(
    transaction_plan: TransactionPlan,
    action_plan: ActionPlan,
    full_viewing_key: FullViewingKey,
    witness: WitnessData,
) -> WasmResult<Action> {
    let memo_key = transaction_plan.memo.map(|memo_plan| memo_plan.key);

    let action = ActionPlan::build_unauth(action_plan, &full_viewing_key, &witness, memo_key)?;

    Ok(action)
}

/// The single-threaded build, kept as a reference for tests: the threaded
/// paths below must produce the same transaction.
pub fn build_serial_inner(
    fvk: FullViewingKey,
    plan: TransactionPlan,
    witness: WitnessData,
    auth: AuthorizationData,
) -> WasmResult<Transaction> {
    let tx: Transaction = plan.build(&fvk, &witness, &auth)?;

    Ok(tx)
}

/// Assemble a transaction from actions that were already built, applying the
/// authorization data. Pairs with [`prove_actions`], which builds the actions
/// without it.
/// Arguments:
///     actions: `Vec<Actions>`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
///     auth_data: `AuthorizationData`
/// Returns: `Transaction`
#[wasm_bindgen]
pub fn assemble_transaction(
    actions: JsValue,
    transaction_plan: &[u8],
    witness_data: &[u8],
    auth_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let auth = AuthorizationData::decode(auth_data)?;
    let actions: Vec<Action> = serde_wasm_bindgen::from_value(actions)?;

    let tx = assemble_transaction_inner(actions, plan, witness, auth)?;

    Ok(tx.encode_to_vec())
}

pub fn assemble_transaction_inner(
    actions: Vec<Action>,
    plan: TransactionPlan,
    witness: WitnessData,
    auth: AuthorizationData,
) -> WasmResult<Transaction> {
    let transaction = plan.clone().build_unauth_with_actions(actions, &witness)?;
    let tx = plan.apply_auth_data(&auth, transaction)?;

    Ok(tx)
}

/// Build (prove) every action of a transaction plan concurrently, WITHOUT
/// authorization data.
///
/// This is the expensive part of transaction building (one ZK proof per
/// action) and needs only the full viewing key and witness, so callers can
/// start it as soon as the plan is ready -- e.g. while the user is still
/// looking at the approval prompt. The result carries no spend authorization;
/// it must be assembled with [`assemble_transaction`] (which applies the
/// `AuthorizationData`) before it is a valid transaction.
///
/// Uses the thread pool when one was started (`initThreadPool`); without one,
/// rayon runs everything on the calling thread.
///
/// Arguments:
///     full_viewing_key: `FullViewingKey`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
/// Returns: `TransactionBody` bytes whose `actions` field holds the built
///     actions in plan order (all other fields are unset). A proto container
///     is used so the result survives the JSON hops between worker, offscreen
///     document and service worker without serde/JsValue representation issues.
#[wasm_bindgen]
pub fn prove_actions(
    full_viewing_key: &[u8],
    transaction_plan: &[u8],
    witness_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let fvk = FullViewingKey::decode(full_viewing_key)?;

    let actions = prove_actions_inner(&plan, &witness, &fvk)?;

    let body = penumbra_proto::core::transaction::v1::TransactionBody {
        actions: actions.into_iter().map(Into::into).collect(),
        ..Default::default()
    };

    Ok(prost::Message::encode_to_vec(&body))
}

pub fn prove_actions_inner(
    plan: &TransactionPlan,
    witness: &WitnessData,
    fvk: &FullViewingKey,
) -> WasmResult<Vec<Action>> {
    let memo_key = plan.memo.as_ref().map(|memo_plan| memo_plan.key);

    // Build all actions in parallel using rayon; collect preserves plan order.
    let actions = plan
        .actions
        .par_iter()
        .map(|action_plan| ActionPlan::build_unauth(action_plan.clone(), fvk, witness, memo_key))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(actions)
}

/// Build a whole transaction: every action is proven concurrently, then the
/// authorization data is applied.
///
/// Prefer [`prove_actions`] + [`assemble_transaction`] when authorization
/// arrives later than the plan (it lets proving overlap user approval).
///
/// Arguments:
///     full_viewing_key: `FullViewingKey`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
///     auth_data: `AuthorizationData`
/// Returns: `Transaction`
#[wasm_bindgen]
pub fn build_transaction(
    full_viewing_key: &[u8],
    transaction_plan: &[u8],
    witness_data: &[u8],
    auth_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let auth = AuthorizationData::decode(auth_data)?;
    let fvk = FullViewingKey::decode(full_viewing_key)?;

    let actions = prove_actions_inner(&plan, &witness, &fvk)?;

    // Assemble the final transaction
    let tx = assemble_transaction_inner(actions, plan, witness, auth)?;

    Ok(tx.encode_to_vec())
}
