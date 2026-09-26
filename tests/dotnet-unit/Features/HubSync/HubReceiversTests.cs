using MultiTokenMonitor.Features.HubSync;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubSync;

public sealed class HubReceiversTests
{
    public sealed class NextRetryDelay
    {
        [Fact]
        public void ConsecutiveFailures_DoubleDelayUpToSixtySeconds()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var delay = TimeSpan.FromSeconds(1);
            var delays = new List<double> { delay.TotalSeconds };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            for (var i = 0; i < 8; i++)
            {
                delay = HubReceivers.NextRetryDelay(delay);
                delays.Add(delay.TotalSeconds);
            }

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            delays.ShouldBe([1, 2, 4, 8, 16, 32, 60, 60, 60]);
        }
    }
}
