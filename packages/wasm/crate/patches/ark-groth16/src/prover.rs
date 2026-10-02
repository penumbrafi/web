use crate::{r1cs_to_qap::R1CSToQAP, Groth16, Proof, ProvingKey, VerifyingKey};
use ark_ec::{pairing::Pairing, AffineRepr, CurveGroup, Group, VariableBaseMSM};
use ark_ff::{Field, PrimeField, UniformRand, Zero};
use ark_poly::GeneralEvaluationDomain;
use ark_relations::r1cs::{
    ConstraintMatrices, ConstraintSynthesizer, ConstraintSystem, OptimizationGoal,
    Result as R1CSResult, SynthesisError, SynthesisMode,
};
use ark_std::rand::Rng;
use ark_std::{
    cfg_into_iter, cfg_iter,
    ops::{AddAssign, Mul},
    vec::Vec,
};

#[cfg(feature = "parallel")]
use rayon::prelude::*;

type D<F> = GeneralEvaluationDomain<F>;

#[cfg(feature = "parallel")]
use rayon::join;

#[cfg(not(feature = "parallel"))]
fn join<A, B>(a: impl FnOnce() -> A, b: impl FnOnce() -> B) -> (A, B) {
    (a(), b())
}

/// R1CS matrices depend only on a circuit's shape, which Groth16 fixes per
/// circuit, so they are built on a circuit type's first proof and reused. A
/// proof built from cached matrices is byte-identical to one built from fresh
/// ones; a shape mismatch drops the entry and fails that one proof.
#[cfg(feature = "std")]
mod matrix_cache {
    use ark_relations::r1cs::ConstraintMatrices;
    use std::any::Any;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};

    type Key = (&'static str, &'static str);
    static CACHE: OnceLock<Mutex<HashMap<Key, Arc<dyn Any + Send + Sync>>>> = OnceLock::new();

    fn key<C, F>() -> Key {
        (core::any::type_name::<C>(), core::any::type_name::<F>())
    }

    pub fn get<C, F: ark_ff::Field>() -> Option<Arc<ConstraintMatrices<F>>> {
        let map = CACHE.get_or_init(Default::default).lock().ok()?;
        map.get(&key::<C, F>())?.clone().downcast().ok()
    }

    pub fn put<C, F: ark_ff::Field>(m: ConstraintMatrices<F>) {
        if let Ok(mut map) = CACHE.get_or_init(Default::default).lock() {
            map.insert(key::<C, F>(), Arc::new(m));
        }
    }

    pub fn drop_entry<C, F>() {
        if let Ok(mut map) = CACHE.get_or_init(Default::default).lock() {
            map.remove(&key::<C, F>());
        }
    }
}

impl<E: Pairing, QAP: R1CSToQAP> Groth16<E, QAP> {
    /// Create a Groth16 proof using randomness `r` and `s` and
    /// the provided R1CS-to-QAP reduction, using the provided
    /// R1CS constraint matrices.
    #[inline]
    pub fn create_proof_with_reduction_and_matrices(
        pk: &ProvingKey<E>,
        r: E::ScalarField,
        s: E::ScalarField,
        matrices: &ConstraintMatrices<E::ScalarField>,
        num_inputs: usize,
        num_constraints: usize,
        full_assignment: &[E::ScalarField],
    ) -> R1CSResult<Proof<E>> {
        let prover_time = start_timer!(|| "Groth16::Prover");
        let witness_map_time = start_timer!(|| "R1CS to QAP witness map");
        let h = QAP::witness_map_from_matrices::<E::ScalarField, D<E::ScalarField>>(
            matrices,
            num_inputs,
            num_constraints,
            full_assignment,
        )?;
        end_timer!(witness_map_time);
        let input_assignment = &full_assignment[1..num_inputs];
        let aux_assignment = &full_assignment[num_inputs..];
        let proof =
            Self::create_proof_with_assignment(pk, r, s, &h, input_assignment, aux_assignment)?;
        end_timer!(prover_time);

        Ok(proof)
    }

    #[inline]
    fn create_proof_with_assignment(
        pk: &ProvingKey<E>,
        r: E::ScalarField,
        s: E::ScalarField,
        h: &[E::ScalarField],
        input_assignment: &[E::ScalarField],
        aux_assignment: &[E::ScalarField],
    ) -> R1CSResult<Proof<E>> {
        let h_assignment = cfg_into_iter!(h)
            .map(|s| s.into_bigint())
            .collect::<Vec<_>>();
        let aux_assignment = cfg_iter!(aux_assignment)
            .map(|s| s.into_bigint())
            .collect::<Vec<_>>();
        let assignment = [
            &input_assignment
                .iter()
                .map(|s| s.into_bigint())
                .collect::<Vec<_>>()[..],
            &aux_assignment[..],
        ]
        .concat();

        let r_g1 = pk.delta_g1.mul(r);
        let s_g1 = pk.delta_g1.mul(s);
        let s_g2 = pk.vk.delta_g2.mul(s);

        // The five MSMs are independent, so they run side by side instead of
        // one after another: each alone parallelises only across its windows.
        let msm_time = start_timer!(|| "MSMs");
        let ((h_acc, l_aux_acc), (g_a, (g1_b, g2_b))) = join(
            || {
                join(
                    || E::G1::msm_bigint(&pk.h_query, &h_assignment),
                    || E::G1::msm_bigint(&pk.l_query, &aux_assignment),
                )
            },
            || {
                join(
                    || Self::calculate_coeff(r_g1, &pk.a_query, pk.vk.alpha_g1, &assignment),
                    || {
                        join(
                            || {
                                if r.is_zero() {
                                    E::G1::zero()
                                } else {
                                    Self::calculate_coeff(
                                        s_g1,
                                        &pk.b_g1_query,
                                        pk.beta_g1,
                                        &assignment,
                                    )
                                }
                            },
                            || {
                                Self::calculate_coeff(
                                    s_g2,
                                    &pk.b_g2_query,
                                    pk.vk.beta_g2,
                                    &assignment,
                                )
                            },
                        )
                    },
                )
            },
        );
        end_timer!(msm_time);

        let r_s_delta_g1 = pk
            .delta_g1
            .into_group()
            .mul_bigint(&r.into_bigint())
            .mul_bigint(&s.into_bigint());
        let s_g_a = g_a.mul_bigint(&s.into_bigint());
        let r_g1_b = g1_b.mul_bigint(&r.into_bigint());

        let c_time = start_timer!(|| "Finish C");
        let mut g_c = s_g_a;
        g_c += &r_g1_b;
        g_c -= &r_s_delta_g1;
        g_c += &l_aux_acc;
        g_c += &h_acc;
        end_timer!(c_time);

        Ok(Proof {
            a: g_a.into_affine(),
            b: g2_b.into_affine(),
            c: g_c.into_affine(),
        })
    }

    /// Create a Groth16 proof that is zero-knowledge using the provided
    /// R1CS-to-QAP reduction.
    /// This method samples randomness for zero knowledges via `rng`.
    #[inline]
    pub fn create_random_proof_with_reduction<C>(
        circuit: C,
        pk: &ProvingKey<E>,
        rng: &mut impl Rng,
    ) -> R1CSResult<Proof<E>>
    where
        C: ConstraintSynthesizer<E::ScalarField>,
    {
        let r = E::ScalarField::rand(rng);
        let s = E::ScalarField::rand(rng);

        Self::create_proof_with_reduction(circuit, pk, r, s)
    }

    /// Create a Groth16 proof that is *not* zero-knowledge with the provided
    /// R1CS-to-QAP reduction.
    #[inline]
    pub fn create_proof_with_reduction_no_zk<C>(
        circuit: C,
        pk: &ProvingKey<E>,
    ) -> R1CSResult<Proof<E>>
    where
        C: ConstraintSynthesizer<E::ScalarField>,
    {
        Self::create_proof_with_reduction(
            circuit,
            pk,
            E::ScalarField::zero(),
            E::ScalarField::zero(),
        )
    }

    /// Create a Groth16 proof using randomness `r` and `s` and the provided
    /// R1CS-to-QAP reduction.
    #[inline]
    pub fn create_proof_with_reduction<C>(
        circuit: C,
        pk: &ProvingKey<E>,
        r: E::ScalarField,
        s: E::ScalarField,
    ) -> R1CSResult<Proof<E>>
    where
        E: Pairing,
        C: ConstraintSynthesizer<E::ScalarField>,
        QAP: R1CSToQAP,
    {
        let prover_time = start_timer!(|| "Groth16::Prover");
        let cs = ConstraintSystem::new_ref();

        // Set the optimization goal
        cs.set_optimization_goal(OptimizationGoal::Constraints);

        #[cfg(feature = "std")]
        if let Some(matrices) = matrix_cache::get::<C, E::ScalarField>() {
            // assignments only: the matrices are already known
            cs.borrow_mut()
                .ok_or(SynthesisError::MissingCS)?
                .set_mode(SynthesisMode::Prove {
                    construct_matrices: false,
                });
            circuit.generate_constraints(cs.clone())?;
            let prover = cs.borrow().ok_or(SynthesisError::MissingCS)?;
            if prover.num_constraints != matrices.num_constraints
                || prover.num_instance_variables != matrices.num_instance_variables
                || prover.num_witness_variables != matrices.num_witness_variables
            {
                matrix_cache::drop_entry::<C, E::ScalarField>();
                return Err(SynthesisError::Unsatisfiable);
            }
            let full_assignment = [
                &prover.instance_assignment[..],
                &prover.witness_assignment[..],
            ]
            .concat();
            let h = QAP::witness_map_from_matrices::<E::ScalarField, D<E::ScalarField>>(
                &matrices,
                prover.num_instance_variables,
                prover.num_constraints,
                &full_assignment,
            )?;
            let proof = Self::create_proof_with_assignment(
                pk,
                r,
                s,
                &h,
                &prover.instance_assignment[1..],
                &prover.witness_assignment,
            )?;
            end_timer!(prover_time);
            return Ok(proof);
        }

        // Synthesize the circuit.
        let synthesis_time = start_timer!(|| "Constraint synthesis");
        circuit.generate_constraints(cs.clone())?;
        debug_assert!(cs.is_satisfied().unwrap());
        end_timer!(synthesis_time);

        let lc_time = start_timer!(|| "Inlining LCs");
        cs.finalize();
        end_timer!(lc_time);

        let witness_map_time = start_timer!(|| "R1CS to QAP witness map");
        let h = QAP::witness_map::<E::ScalarField, D<E::ScalarField>>(cs.clone())?;
        end_timer!(witness_map_time);

        #[cfg(feature = "std")]
        if let Some(matrices) = cs.to_matrices() {
            matrix_cache::put::<C, E::ScalarField>(matrices);
        }

        let prover = cs.borrow().unwrap();
        let proof = Self::create_proof_with_assignment(
            pk,
            r,
            s,
            &h,
            &prover.instance_assignment[1..],
            &prover.witness_assignment,
        )?;

        end_timer!(prover_time);

        Ok(proof)
    }

    /// Given a Groth16 proof, returns a fresh proof of the same statement. For a proof π of a
    /// statement S, the output of the non-deterministic procedure `rerandomize_proof(π)` is
    /// statistically indistinguishable from a fresh honest proof of S. For more info, see theorem 3 of
    /// [\[BKSV20\]](https://eprint.iacr.org/2020/811)
    pub fn rerandomize_proof(
        vk: &VerifyingKey<E>,
        proof: &Proof<E>,
        rng: &mut impl Rng,
    ) -> Proof<E> {
        // These are our rerandomization factors. They must be nonzero and uniformly sampled.
        let (mut r1, mut r2) = (E::ScalarField::zero(), E::ScalarField::zero());
        while r1.is_zero() || r2.is_zero() {
            r1 = E::ScalarField::rand(rng);
            r2 = E::ScalarField::rand(rng);
        }

        // See figure 1 in the paper referenced above:
        //   A' = (1/r₁)A
        //   B' = r₁B + r₁r₂(δG₂)
        //   C' = C + r₂A

        // We can unwrap() this because r₁ is guaranteed to be nonzero
        let new_a = proof.a.mul(r1.inverse().unwrap());
        let new_b = proof.b.mul(r1) + &vk.delta_g2.mul(r1 * &r2);
        let new_c = proof.c + proof.a.mul(r2).into_affine();

        Proof {
            a: new_a.into_affine(),
            b: new_b.into_affine(),
            c: new_c.into_affine(),
        }
    }

    fn calculate_coeff<G: AffineRepr>(
        initial: G::Group,
        query: &[G],
        vk_param: G,
        assignment: &[<G::ScalarField as PrimeField>::BigInt],
    ) -> G::Group
    where
        G::Group: VariableBaseMSM<MulBase = G>,
    {
        let el = query[0];
        let acc = G::Group::msm_bigint(&query[1..], assignment);

        let mut res = initial;
        res.add_assign(&el);
        res += &acc;
        res.add_assign(&vk_param);

        res
    }
}
