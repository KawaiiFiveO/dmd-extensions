using LibDmd.Output;

namespace LibDmd.Test.Stubs
{
	/// <summary>
	/// A dynamic gray2 destination that smooths edges itself, like the virtual DMD with smooth edges enabled.
	/// </summary>
	public class DestinationDynamicGray2Smoothing : DestinationDynamicGray2, ISmoothingDestination
	{
		public bool SmoothsEdges { get; set; } = true;
	}
}
