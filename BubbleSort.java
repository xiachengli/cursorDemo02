import java.util.Arrays;

/**
 * 冒泡排序示例：相邻元素比较并交换，每轮将最大元素“浮”到末尾。
 */
public class BubbleSort {

    /**
     * 对整型数组进行升序冒泡排序（原地修改）。
     *
     * @param arr 待排序数组，可为 null；为 null 时不做任何操作
     */
    public static void bubbleSort(int[] arr) {
        if (arr == null || arr.length < 2) {
            return;
        }
        int n = arr.length;
        for (int i = 0; i < n - 1; i++) {
            boolean swapped = false;
            for (int j = 0; j < n - 1 - i; j++) {
                if (arr[j] > arr[j + 1]) {
                    swap(arr, j, j + 1);
                    swapped = true;
                }
            }
            if (!swapped) {
                break;
            }
        }
    }

    /**
     * 交换数组中两个下标处的元素。
     *
     * @param arr 数组
     * @param i   第一个下标
     * @param j   第二个下标
     */
    private static void swap(int[] arr, int i, int j) {
        int t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }

    /**
     * 演示入口：打印排序前后数组。
     *
     * @param args 命令行参数（未使用）
     */
    public static void main(String[] args) {
        int[] data = {64, 34, 25, 12, 22, 11, 90};
        System.out.println("排序前: " + Arrays.toString(data));
        bubbleSort(data);
        System.out.println("排序后: " + Arrays.toString(data));
    }
}
