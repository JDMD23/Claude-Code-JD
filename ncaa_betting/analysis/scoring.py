"""Scoring functions and confidence-tier assignment for matchup analysis.

Converts raw ``DimensionResult`` vectors into a single composite score
(0 -- 10 scale) for both spread and total markets, assigns a human-readable
confidence tier, and computes a Kelly-criterion bankroll fraction.
"""

from __future__ import annotations

import math
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .pipeline import DimensionResult


# ---------------------------------------------------------------------------
# Confidence tiers
# ---------------------------------------------------------------------------

class ConfidenceTier(str, Enum):
    """Categorical confidence label applied to every pick."""

    LOCK = "LOCK"
    STRONG = "STRONG"
    LEAN = "LEAN"
    SKIP = "SKIP"

    def __str__(self) -> str:          # noqa: D105  (simple repr)
        return self.value


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_COMPOSITE_FLOOR: float = 0.0
_COMPOSITE_CEILING: float = 10.0

# The raw weighted average of (edge * confidence) typically lands in a
# narrow band.  We multiply by this constant *before* clipping so that
# the 0-10 scale is well-utilised across realistic inputs.
_RAW_TO_SCALE_FACTOR: float = 10.0


def _clip(value: float, lo: float, hi: float) -> float:
    """Clamp *value* to [*lo*, *hi*]."""
    return max(lo, min(hi, value))


def _weighted_edge(
    results: list[DimensionResult],
    weights: dict[str, float],
    edge_attr: str,
) -> float:
    """Compute a weighted composite from a list of dimension results.

    For each dimension result the contribution is::

        edge_value * confidence * weight

    where *edge_value* is read from *edge_attr* (``"spread_edge"`` or
    ``"total_edge"``), *confidence* is the dimension's self-reported
    confidence, and *weight* is the pipeline's dimension weight.

    The signed sum is then rescaled to the 0-10 range using the absolute
    value (the caller already knows the sign convention from the original
    edge values).

    Parameters
    ----------
    results:
        One ``DimensionResult`` per dimension that was evaluated.
    weights:
        Mapping of dimension name -> weight (values should sum to 1.0).
    edge_attr:
        Name of the attribute on ``DimensionResult`` to use as the edge
        value.  Either ``"spread_edge"`` or ``"total_edge"``.

    Returns
    -------
    float
        Composite score clipped to [0.0, 10.0].  Higher magnitude means
        stronger conviction; the *sign* is stripped (magnitude only) because
        direction is already captured in the edge values themselves.
    """
    if not results:
        return 0.0

    total_weight = 0.0
    weighted_sum = 0.0

    for dim in results:
        w = weights.get(dim.name, 0.0)
        edge = getattr(dim, edge_attr, 0.0)
        weighted_sum += edge * dim.confidence * w
        total_weight += w

    # Guard against an empty or zero-weight set.
    if total_weight == 0.0:
        return 0.0

    # Normalise by total weight so that missing dimensions don't deflate the
    # score.  Then take absolute value and scale to 0-10.
    normalised = weighted_sum / total_weight
    scaled = abs(normalised) * _RAW_TO_SCALE_FACTOR

    return _clip(scaled, _COMPOSITE_FLOOR, _COMPOSITE_CEILING)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_spread_composite(
    results: list[DimensionResult],
    weights: dict[str, float],
) -> float:
    """Return a 0-10 composite score for the **spread** market.

    Higher values indicate stronger conviction.  The sign of individual
    ``spread_edge`` values encodes direction (positive = away-side value,
    negative = home-side value), but the composite itself is always
    non-negative so it can be fed directly into :func:`assign_tier`.

    Parameters
    ----------
    results:
        ``DimensionResult`` instances produced by the analysis pipeline.
    weights:
        ``AnalysisPipeline.DIMENSION_WEIGHTS`` dictionary.

    Returns
    -------
    float
        Composite score in [0.0, 10.0].
    """
    return _weighted_edge(results, weights, "spread_edge")


def compute_total_composite(
    results: list[DimensionResult],
    weights: dict[str, float],
) -> float:
    """Return a 0-10 composite score for the **total (O/U)** market.

    Positive ``total_edge`` values indicate *over* value; negative values
    indicate *under* value.  Like the spread composite, the returned score
    is always non-negative.

    Parameters
    ----------
    results:
        ``DimensionResult`` instances produced by the analysis pipeline.
    weights:
        ``AnalysisPipeline.DIMENSION_WEIGHTS`` dictionary.

    Returns
    -------
    float
        Composite score in [0.0, 10.0].
    """
    return _weighted_edge(results, weights, "total_edge")


def assign_tier(composite: float) -> ConfidenceTier:
    """Map a composite score to a categorical confidence tier.

    Thresholds
    ----------
    * ``>= 7.0`` -- :attr:`ConfidenceTier.LOCK`
    * ``>= 4.5`` -- :attr:`ConfidenceTier.STRONG`
    * ``>= 2.0`` -- :attr:`ConfidenceTier.LEAN`
    * ``<  2.0`` -- :attr:`ConfidenceTier.SKIP`

    Parameters
    ----------
    composite:
        Composite score in [0.0, 10.0].

    Returns
    -------
    ConfidenceTier
    """
    if composite >= 7.0:
        return ConfidenceTier.LOCK
    if composite >= 4.5:
        return ConfidenceTier.STRONG
    if composite >= 2.0:
        return ConfidenceTier.LEAN
    return ConfidenceTier.SKIP


def compute_kelly_fraction(
    composite: float,
    implied_prob: float = 0.5,
) -> float:
    """Compute a Kelly-criterion fraction for bankroll sizing.

    The composite score (0-10) is converted to an estimated win probability
    using a logistic mapping::

        est_prob = 1 / (1 + exp(-k * (composite - midpoint)))

    with *midpoint* = 5.0 and *k* = 0.6, which produces a smooth curve
    where:
    * composite ~0  -> est_prob ~5 %
    * composite  5  -> est_prob 50 %
    * composite 10  -> est_prob ~95 %

    The Kelly fraction is then::

        f* = (est_prob - implied_prob) / (1 - implied_prob)

    clamped to [0.0, 0.25] to prevent over-betting (quarter-Kelly cap).

    For composite scores that yield an estimated probability at or below
    the implied probability, the fraction is 0.0 (no bet).

    Parameters
    ----------
    composite:
        Composite score in [0.0, 10.0].
    implied_prob:
        Market-implied win probability, defaulting to a coin flip (0.5).
        For standard -110 juice this would be ~0.524.

    Returns
    -------
    float
        Recommended fraction of bankroll to wager, in [0.0, 0.25].
    """
    # Logistic mapping parameters.
    midpoint = 5.0
    steepness = 0.6

    # Guard against extreme float values in the exponent.
    z = -steepness * (composite - midpoint)
    z = _clip(z, -500.0, 500.0)
    estimated_prob = 1.0 / (1.0 + math.exp(z))

    # Edge over the market.
    if implied_prob >= 1.0:
        return 0.0

    edge = estimated_prob - implied_prob
    if edge <= 0.0:
        return 0.0

    kelly = edge / (1.0 - implied_prob)

    # Quarter-Kelly cap to limit variance.
    max_fraction = 0.25
    return _clip(kelly, 0.0, max_fraction)
