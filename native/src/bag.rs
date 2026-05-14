use napi::bindgen_prelude::{Error, Result};
use napi_derive::napi;

use crate::firepower::firepower_score;
use crate::pieces::{parse_queue, piece_name, Piece};
use crate::spin::SpinMode;
use crate::tetrio_tables::{ComboTable, KickTable};
use crate::{search_opener_states, validate_beam_width, SearchState};

const BAG_SAMPLE_MULTIPLIER: usize = 197;

#[derive(Clone)]
#[napi(object)]
pub struct OpenerQueueEvaluation {
    pub queue: String,
    pub buildable: bool,
    pub pareto_front: bool,
    pub dominated_by: u32,
    pub weighted_score: f64,
    pub top_score: f64,
    pub firepower_score: f64,
    pub attack: u32,
    pub difficult_attack: u32,
    pub points: u32,
    pub all_clears: u32,
    pub difficult_clears: u32,
    pub t_spin_clears: u32,
    pub t_spin_attack: u32,
    pub back_to_back_chain: u32,
    pub t_spin_potential: u32,
    pub depth: u32,
    pub holes: u32,
    pub bumpiness: u32,
}

#[napi(object)]
pub struct OpenerBagEvaluation {
    pub bag: String,
    pub total_queues: u32,
    pub searched_queues: u32,
    pub exact: bool,
    pub buildable_queues: u32,
    pub build_rate: f64,
    pub average_score: f64,
    pub average_attack: f64,
    pub average_firepower_score: f64,
    pub average_holes: f64,
    pub average_bumpiness: f64,
    pub worst_score: f64,
    pub best_score: f64,
    pub pareto_front: Vec<OpenerQueueEvaluation>,
    pub top_queues: Vec<OpenerQueueEvaluation>,
}

pub(crate) fn evaluate_opener_bag_internal(
    bag: &str,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    max_queues: u32,
    top_queue_count: u32,
    combo_table: ComboTable,
    kick_table: KickTable,
    spin_mode: SpinMode,
) -> Result<OpenerBagEvaluation> {
    let pieces = parse_unique_bag(bag)?;
    let total_queues = factorial(pieces.len());
    let max_queues = if max_queues == 0 {
        total_queues
    } else {
        usize::min(max_queues as usize, total_queues)
    };
    let top_queue_count = if top_queue_count == 0 {
        16
    } else {
        top_queue_count as usize
    };
    let beam_width = validate_beam_width(beam_width)?;
    let max_depth = usize::min(max_depth as usize, pieces.len());

    let mut evaluations = Vec::with_capacity(max_queues);
    for sample in 0..max_queues {
        let queue = nth_piece_permutation(
            &pieces,
            sampled_piece_permutation_index(sample, max_queues, total_queues),
        );
        let states = search_opener_states(
            &queue,
            beam_width,
            hold_enabled,
            max_depth,
            false,
            combo_table,
            kick_table,
            spin_mode,
        );
        evaluations.push(evaluate_queue(
            queue_to_string(&queue),
            states.into_iter().next(),
            max_depth,
        ));
    }

    mark_pareto_fronts(&mut evaluations);
    evaluations.sort_by(compare_queue_evaluation);

    let searched_queues = evaluations.len() as u32;
    let buildable_queues = evaluations
        .iter()
        .filter(|evaluation| evaluation.buildable)
        .count() as u32;
    let denominator = f64::from(searched_queues.max(1));
    let average_score = evaluations
        .iter()
        .map(|evaluation| evaluation.top_score)
        .sum::<f64>()
        / denominator;
    let average_attack = evaluations
        .iter()
        .map(|evaluation| f64::from(evaluation.attack))
        .sum::<f64>()
        / denominator;
    let average_firepower_score = evaluations
        .iter()
        .map(|evaluation| evaluation.firepower_score)
        .sum::<f64>()
        / denominator;
    let average_holes = evaluations
        .iter()
        .map(|evaluation| f64::from(evaluation.holes))
        .sum::<f64>()
        / denominator;
    let average_bumpiness = evaluations
        .iter()
        .map(|evaluation| f64::from(evaluation.bumpiness))
        .sum::<f64>()
        / denominator;
    let worst_score = evaluations
        .iter()
        .map(|evaluation| evaluation.top_score)
        .reduce(f64::min)
        .unwrap_or(0.0);
    let best_score = evaluations
        .iter()
        .map(|evaluation| evaluation.top_score)
        .reduce(f64::max)
        .unwrap_or(0.0);
    let pareto_front = evaluations
        .iter()
        .filter(|evaluation| evaluation.pareto_front)
        .take(top_queue_count)
        .cloned()
        .collect();
    let top_queues = evaluations.iter().take(top_queue_count).cloned().collect();

    Ok(OpenerBagEvaluation {
        bag: queue_to_string(&pieces),
        total_queues: total_queues as u32,
        searched_queues,
        exact: searched_queues as usize == total_queues,
        buildable_queues,
        build_rate: f64::from(buildable_queues) / denominator,
        average_score,
        average_attack,
        average_firepower_score,
        average_holes,
        average_bumpiness,
        worst_score,
        best_score,
        pareto_front,
        top_queues,
    })
}

fn parse_unique_bag(input: &str) -> Result<Vec<Piece>> {
    let pieces = parse_queue(input)?;
    if pieces.len() > 7 {
        return Err(Error::from_reason(format!(
            "bag must contain at most 7 unique tetrominoes, got {}.",
            pieces.len()
        )));
    }

    let mut unique = Vec::with_capacity(pieces.len());
    for piece in pieces {
        if unique.contains(&piece) {
            return Err(Error::from_reason(format!(
                "bag must not repeat tetromino {}.",
                piece_name(piece)
            )));
        }
        unique.push(piece);
    }
    Ok(unique)
}

fn factorial(value: usize) -> usize {
    (1..=value).product::<usize>().max(1)
}

fn sampled_piece_permutation_index(sample: usize, queue_count: usize, total_queues: usize) -> usize {
    if queue_count == total_queues {
        sample
    } else {
        (sample * BAG_SAMPLE_MULTIPLIER) % total_queues
    }
}

fn nth_piece_permutation(pieces: &[Piece], index: usize) -> Vec<Piece> {
    let mut remaining = pieces.to_vec();
    let mut cursor = index;
    let mut output = Vec::with_capacity(pieces.len());
    for divisor in (1..=pieces.len()).rev() {
        let block = factorial(divisor - 1);
        let selected = cursor / block;
        output.push(remaining.remove(selected));
        cursor %= block;
    }
    output
}

fn queue_to_string(pieces: &[Piece]) -> String {
    pieces.iter().map(|piece| piece_name(*piece)).collect()
}

fn evaluate_queue(
    queue: String,
    state: Option<SearchState>,
    target_depth: usize,
) -> OpenerQueueEvaluation {
    let Some(state) = state else {
        return OpenerQueueEvaluation {
            queue,
            buildable: false,
            pareto_front: false,
            dominated_by: 0,
            weighted_score: f64::NEG_INFINITY,
            top_score: f64::NEG_INFINITY,
            firepower_score: 0.0,
            attack: 0,
            difficult_attack: 0,
            points: 0,
            all_clears: 0,
            difficult_clears: 0,
            t_spin_clears: 0,
            t_spin_attack: 0,
            back_to_back_chain: 0,
            t_spin_potential: 0,
            depth: 0,
            holes: u32::MAX,
            bumpiness: u32::MAX,
        };
    };

    let depth = state.path.len() as u32;
    let buildable = state.path.len() == target_depth;
    let firepower_score = firepower_score(state.firepower);
    let weighted_score = opener_weighted_score(&state, buildable);
    OpenerQueueEvaluation {
        queue,
        buildable,
        pareto_front: false,
        dominated_by: 0,
        weighted_score,
        top_score: state.score,
        firepower_score,
        attack: state.firepower.attack,
        difficult_attack: state.firepower.difficult_attack,
        points: state.firepower.points,
        all_clears: state.firepower.all_clears,
        difficult_clears: state.firepower.difficult_clears,
        t_spin_clears: state.firepower.t_spin_clears,
        t_spin_attack: state.firepower.t_spin_attack,
        back_to_back_chain: state.firepower.back_to_back_chain,
        t_spin_potential: state.t_spin_potential,
        depth,
        holes: state.metrics[3],
        bumpiness: state.metrics[4],
    }
}

fn opener_weighted_score(state: &SearchState, buildable: bool) -> f64 {
    let buildable_bonus = if buildable { 10_000.0 } else { 0.0 };
    buildable_bonus
        + state.score
        + f64::from(state.firepower.difficult_attack) * 900.0
        + f64::from(state.firepower.t_spin_attack) * 1_200.0
        + f64::from(state.firepower.t_spin_clears) * 2_500.0
        + f64::from(state.firepower.difficult_clears) * 1_200.0
        + f64::from(state.firepower.back_to_back_chain) * 1_000.0
        + f64::from(state.t_spin_potential) * 800.0
        + state.path.len() as f64 * 250.0
        - f64::from(state.metrics[3]) * 120.0
        - f64::from(state.metrics[4]) * 20.0
}

fn mark_pareto_fronts(evaluations: &mut [OpenerQueueEvaluation]) {
    for index in 0..evaluations.len() {
        let mut dominated_by = 0;
        for other_index in 0..evaluations.len() {
            if index != other_index && dominates(&evaluations[other_index], &evaluations[index]) {
                dominated_by += 1;
            }
        }
        evaluations[index].dominated_by = dominated_by;
        evaluations[index].pareto_front = dominated_by == 0;
    }
}

fn dominates(left: &OpenerQueueEvaluation, right: &OpenerQueueEvaluation) -> bool {
    let no_worse = u8::from(left.buildable) >= u8::from(right.buildable)
        && left.depth >= right.depth
        && left.t_spin_clears >= right.t_spin_clears
        && left.t_spin_attack >= right.t_spin_attack
        && left.back_to_back_chain >= right.back_to_back_chain
        && left.difficult_clears >= right.difficult_clears
        && left.difficult_attack >= right.difficult_attack
        && left.t_spin_potential >= right.t_spin_potential
        && left.attack >= right.attack
        && left.top_score >= right.top_score
        && left.holes <= right.holes
        && left.bumpiness <= right.bumpiness;
    let strictly_better = u8::from(left.buildable) > u8::from(right.buildable)
        || left.depth > right.depth
        || left.t_spin_clears > right.t_spin_clears
        || left.t_spin_attack > right.t_spin_attack
        || left.back_to_back_chain > right.back_to_back_chain
        || left.difficult_clears > right.difficult_clears
        || left.difficult_attack > right.difficult_attack
        || left.t_spin_potential > right.t_spin_potential
        || left.attack > right.attack
        || left.top_score > right.top_score
        || left.holes < right.holes
        || left.bumpiness < right.bumpiness;
    no_worse && strictly_better
}

fn compare_queue_evaluation(
    left: &OpenerQueueEvaluation,
    right: &OpenerQueueEvaluation,
) -> std::cmp::Ordering {
    right
        .pareto_front
        .cmp(&left.pareto_front)
        .then_with(|| left.dominated_by.cmp(&right.dominated_by))
        .then_with(|| right.weighted_score.total_cmp(&left.weighted_score))
        .then_with(|| right.t_spin_clears.cmp(&left.t_spin_clears))
        .then_with(|| right.t_spin_attack.cmp(&left.t_spin_attack))
        .then_with(|| right.back_to_back_chain.cmp(&left.back_to_back_chain))
        .then_with(|| right.difficult_attack.cmp(&left.difficult_attack))
        .then_with(|| right.t_spin_potential.cmp(&left.t_spin_potential))
        .then_with(|| right.top_score.total_cmp(&left.top_score))
        .then_with(|| left.queue.cmp(&right.queue))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_piece_permutations_keep_factorial_coverage() {
        let pieces = vec![Piece::T, Piece::I, Piece::O];
        let permutations = sampled_piece_permutations(&pieces, 6);
        let queues = permutations
            .iter()
            .map(|queue| queue_to_string(queue))
            .collect::<Vec<_>>();

        assert_eq!(queues.len(), 6);
        assert_eq!(
            queues,
            vec!["TIO", "TOI", "ITO", "IOT", "OTI", "OIT"]
        );
    }

    #[test]
    fn capped_piece_permutations_sample_across_first_pieces() {
        let pieces = vec![
            Piece::T,
            Piece::I,
            Piece::J,
            Piece::L,
            Piece::O,
            Piece::S,
            Piece::Z,
        ];
        let permutations = sampled_piece_permutations(&pieces, 12);
        let mut first_pieces = permutations
            .iter()
            .map(|queue| piece_name(queue[0]))
            .collect::<Vec<_>>();
        first_pieces.sort_unstable();
        first_pieces.dedup();

        assert_eq!(permutations.len(), 12);
        assert!(
            first_pieces.len() > 1,
            "capped sampling should not stay in the first DFS prefix"
        );
    }

    fn sampled_piece_permutations(pieces: &[Piece], queue_count: usize) -> Vec<Vec<Piece>> {
        let total_queues = factorial(pieces.len());
        (0..queue_count)
            .map(|sample| {
                nth_piece_permutation(
                    pieces,
                    sampled_piece_permutation_index(sample, queue_count, total_queues),
                )
            })
            .collect()
    }
}
