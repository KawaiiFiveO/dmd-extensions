namespace LibDmd.Output
{
	/// <summary>
	/// A destination that can smooth edges by itself, at a higher resolution than any scaler.
	/// </summary>
	///
	/// <remarks>
	/// While smoothing, the destination gets frames unscaled, independently of the scaler mode,
	/// because an upscaled frame would add staircases that the smoothing then follows.
	/// </remarks>
	public interface ISmoothingDestination
	{
		/// <summary>
		/// True if the destination currently smooths edges and wants unscaled frames.
		/// </summary>
		bool SmoothsEdges { get; }
	}
}
